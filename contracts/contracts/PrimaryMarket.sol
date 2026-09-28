// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AssetToken} from "./AssetToken.sol";
import {FeeConfig} from "./FeeConfig.sol";

/// @title PrimaryMarket — investors buy newly offered shares directly from the producer.
/// @notice Proceeds finance the producer (minus the platform fee). Shares stay with the
///         producer until sold, so unsold shares keep earning revenue for them.
contract PrimaryMarket is FeeConfig, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    IERC20 public immutable usdc;
    AssetToken public immutable token;
    uint256 public immutable minInvestment; // USDC (6 decimals)
    mapping(uint256 => uint256) public offeredRemaining; // assetId -> shares still for sale

    event OfferingOpened(uint256 indexed assetId, uint256 shares);
    event SharesPurchased(uint256 indexed assetId, address indexed buyer, uint256 shares, uint256 cost, uint256 fee);

    error BelowMinimumInvestment(uint256 cost, uint256 minimum);
    error NotEnoughSharesOffered(uint256 requested, uint256 available);

    constructor(address admin, IERC20 usdc_, AssetToken token_, address treasury_, uint16 feeBps_, uint256 minInvestment_)
        FeeConfig(admin, treasury_, feeBps_)
    {
        usdc = usdc_;
        token = token_;
        minInvestment = minInvestment_;
        _grantRole(ISSUER_ROLE, admin);
    }

    /// @notice Offer part of an asset to the public. The producer must approve this contract.
    function openOffering(uint256 assetId, uint256 shares) external onlyRole(ISSUER_ROLE) {
        offeredRemaining[assetId] = shares;
        emit OfferingOpened(assetId, shares);
    }

    function quote(uint256 assetId, uint256 shares) public view returns (uint256 cost, uint256 fee) {
        (, , , uint256 price, ) = token.assets(assetId);
        cost = shares * price;
        fee = feeOn(cost);
    }

    function buy(uint256 assetId, uint256 shares) external nonReentrant {
        (uint256 cost, uint256 fee) = quote(assetId, shares);
        if (cost < minInvestment) revert BelowMinimumInvestment(cost, minInvestment);
        uint256 available = offeredRemaining[assetId];
        if (shares > available) revert NotEnoughSharesOffered(shares, available);
        offeredRemaining[assetId] = available - shares;

        (, address producer, , , ) = token.assets(assetId);
        usdc.safeTransferFrom(msg.sender, producer, cost - fee);
        usdc.safeTransferFrom(msg.sender, treasury, fee);
        token.safeTransferFrom(producer, msg.sender, assetId, shares, "");
        emit SharesPurchased(assetId, msg.sender, shares, cost, fee);
    }
}
