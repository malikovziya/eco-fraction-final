// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {KYCRegistry} from "./KYCRegistry.sol";

interface IShareTransferHook {
    function onShareTransfer(uint256 id, address from, address to, uint256 amount) external;
}

/// @title AssetToken — fractional ownership of renewable energy assets (ERC-1155).
/// @notice Each token id is one asset; each unit is one share. Shares move only between
///         KYC-verified wallets, and every balance change is reported to the revenue
///         distributor so payouts stay exact.
contract AssetToken is ERC1155Supply, AccessControl, Pausable {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct AssetInfo {
        string name;
        address producer;
        uint256 totalShares;
        uint256 pricePerShare; // in USDC (6 decimals)
        bool exists;
    }

    KYCRegistry public immutable kyc;
    IShareTransferHook public revenueHook;
    mapping(uint256 => AssetInfo) public assets;
    uint256[] public assetIds;

    event AssetCreated(uint256 indexed id, string name, address indexed producer, uint256 totalShares, uint256 pricePerShare);

    error NotKYCVerified(address account);
    error AssetExists(uint256 id);
    error HookAlreadySet();

    constructor(address admin, KYCRegistry kyc_, string memory uri_) ERC1155(uri_) {
        kyc = kyc_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /// @dev Set once at deployment; the distributor must see every transfer from genesis.
    function setRevenueHook(IShareTransferHook hook) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(revenueHook) != address(0)) revert HookAlreadySet();
        revenueHook = hook;
    }

    /// @notice Tokenize an asset. All shares start with the producer, so revenue on unsold
    ///         shares keeps flowing to them; the primary market sells the offered part by approval.
    function createAsset(
        uint256 id,
        string calldata name,
        address producer,
        uint256 totalShares,
        uint256 pricePerShare
    ) external onlyRole(ISSUER_ROLE) {
        if (assets[id].exists) revert AssetExists(id);
        assets[id] = AssetInfo(name, producer, totalShares, pricePerShare, true);
        assetIds.push(id);
        _mint(producer, id, totalShares, "");
        emit AssetCreated(id, name, producer, totalShares, pricePerShare);
    }

    function assetCount() external view returns (uint256) {
        return assetIds.length;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override
        whenNotPaused
    {
        if (from != address(0) && !kyc.isVerified(from)) revert NotKYCVerified(from);
        if (to != address(0) && !kyc.isVerified(to)) revert NotKYCVerified(to);
        // Settle revenue at the old balances before they change
        if (address(revenueHook) != address(0)) {
            for (uint256 i = 0; i < ids.length; i++) {
                revenueHook.onShareTransfer(ids[i], from, to, values[i]);
            }
        }
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
