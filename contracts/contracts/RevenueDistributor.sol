// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AssetToken, IShareTransferHook} from "./AssetToken.sol";
import {EnergyOracle} from "./EnergyOracle.sol";

/// @title RevenueDistributor — turns metered energy into USDC payouts for shareholders.
/// @notice For each anchored batch the grid off-taker pays energy × PPA tariff. Verified
///         batches are distributed pro-rata to all holders of that asset through a
///         revenue-per-share accumulator (O(1) per batch, no loops over holders). Batches the
///         AI flagged are held in escrow until the multisig releases or refunds them.
contract RevenueDistributor is AccessControl, ReentrancyGuard, IShareTransferHook {
    using SafeERC20 for IERC20;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant ESCROW_ADMIN_ROLE = keccak256("ESCROW_ADMIN_ROLE");

    uint256 private constant MAGNITUDE = 2 ** 128;

    enum Status {
        None,
        Distributed,
        Escrowed,
        Released,
        Refunded
    }

    struct Settlement {
        uint256 amount;
        Status status;
    }

    IERC20 public immutable usdc;
    AssetToken public immutable token;
    EnergyOracle public immutable oracle;
    address public immutable offtaker; // grid buyer paying for the energy
    uint256 public tariffPerKWh; // USDC (6 decimals) per kWh

    mapping(uint256 => uint256) public magnifiedRevenuePerShare; // assetId -> accumulator
    mapping(uint256 => mapping(address => int256)) private _corrections;
    mapping(uint256 => mapping(address => uint256)) public withdrawn;
    mapping(uint256 => uint256) public totalDistributed; // assetId -> USDC
    mapping(uint256 => Settlement) public settlements; // batchId -> settlement
    uint256 public totalEscrowed;

    event BatchSettled(uint256 indexed batchId, uint256 indexed assetId, uint256 amount, bool escrowed);
    event EscrowReleased(uint256 indexed batchId, uint256 amount);
    event EscrowRefunded(uint256 indexed batchId, uint256 amount);
    event RevenuePaid(uint256 indexed assetId, address indexed account, uint256 amount);
    event TariffChanged(uint256 tariffPerKWh);

    error OnlyToken();
    error AlreadySettled(uint256 batchId);
    error NotEscrowed(uint256 batchId);

    constructor(
        address admin,
        IERC20 usdc_,
        AssetToken token_,
        EnergyOracle oracle_,
        address offtaker_,
        uint256 tariffPerKWh_
    ) {
        usdc = usdc_;
        token = token_;
        oracle = oracle_;
        require(offtaker_ != address(0), "zero offtaker");
        offtaker = offtaker_;
        tariffPerKWh = tariffPerKWh_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ESCROW_ADMIN_ROLE, admin);
    }

    // ── Settlement ──────────────────────────────────────────────────────────

    function revenueFor(uint256 energyWh) public view returns (uint256) {
        return (energyWh * tariffPerKWh) / 1000;
    }

    /// @notice Collect payment for an anchored batch and distribute or escrow it.
    function settle(uint256 batchId) external onlyRole(KEEPER_ROLE) nonReentrant {
        if (settlements[batchId].status != Status.None) revert AlreadySettled(batchId);
        EnergyOracle.Batch memory b = oracle.getBatch(batchId);
        uint256 amount = revenueFor(b.energyWh);

        usdc.safeTransferFrom(offtaker, address(this), amount);
        if (b.flagged) {
            settlements[batchId] = Settlement(amount, Status.Escrowed);
            totalEscrowed += amount;
        } else {
            settlements[batchId] = Settlement(amount, Status.Distributed);
            _distribute(b.assetId, amount);
        }
        emit BatchSettled(batchId, b.assetId, amount, b.flagged);
    }

    /// @notice False alarm: the reviewed batch is paid out to shareholders.
    function releaseEscrow(uint256 batchId) external onlyRole(ESCROW_ADMIN_ROLE) {
        Settlement storage s = _escrowed(batchId);
        s.status = Status.Released;
        totalEscrowed -= s.amount;
        _distribute(oracle.getBatch(batchId).assetId, s.amount);
        emit EscrowReleased(batchId, s.amount);
    }

    /// @notice Confirmed fraud: the grid buyer gets back what it paid for energy that never existed.
    function refundEscrow(uint256 batchId) external onlyRole(ESCROW_ADMIN_ROLE) nonReentrant {
        Settlement storage s = _escrowed(batchId);
        s.status = Status.Refunded;
        totalEscrowed -= s.amount;
        usdc.safeTransfer(offtaker, s.amount);
        emit EscrowRefunded(batchId, s.amount);
    }

    function _escrowed(uint256 batchId) private view returns (Settlement storage s) {
        s = settlements[batchId];
        if (s.status != Status.Escrowed) revert NotEscrowed(batchId);
    }

    function _distribute(uint256 assetId, uint256 amount) private {
        uint256 supply = token.totalSupply(assetId);
        require(supply > 0, "no shares");
        magnifiedRevenuePerShare[assetId] += (amount * MAGNITUDE) / supply;
        totalDistributed[assetId] += amount;
    }

    // ── Payouts ─────────────────────────────────────────────────────────────

    function accumulated(uint256 assetId, address account) public view returns (uint256) {
        int256 magnified = int256(magnifiedRevenuePerShare[assetId] * token.balanceOf(account, assetId));
        return uint256(magnified + _corrections[assetId][account]) / MAGNITUDE;
    }

    function claimable(uint256 assetId, address account) public view returns (uint256) {
        return accumulated(assetId, account) - withdrawn[assetId][account];
    }

    /// @notice Holders can always pull their revenue themselves.
    function claim(uint256 assetId) external nonReentrant {
        _pay(assetId, msg.sender);
    }

    /// @notice Keeper pushes revenue to holders each cycle, so payouts arrive automatically.
    ///         Funds only ever go to the holder's own wallet.
    function payout(uint256 assetId, address[] calldata accounts) external onlyRole(KEEPER_ROLE) nonReentrant {
        for (uint256 i = 0; i < accounts.length; i++) {
            _pay(assetId, accounts[i]);
        }
    }

    function _pay(uint256 assetId, address account) private {
        uint256 amount = claimable(assetId, account);
        if (amount == 0) return;
        withdrawn[assetId][account] += amount;
        usdc.safeTransfer(account, amount);
        emit RevenuePaid(assetId, account, amount);
    }

    /// @dev Called by AssetToken before balances change, so past revenue stays with the sender.
    function onShareTransfer(uint256 id, address from, address to, uint256 amount) external {
        if (msg.sender != address(token)) revert OnlyToken();
        int256 magCorrection = int256(magnifiedRevenuePerShare[id] * amount);
        if (from != address(0)) _corrections[id][from] += magCorrection;
        if (to != address(0)) _corrections[id][to] -= magCorrection;
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    function setTariff(uint256 tariffPerKWh_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        tariffPerKWh = tariffPerKWh_;
        emit TariffChanged(tariffPerKWh_);
    }
}
