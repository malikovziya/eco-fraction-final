// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AssetToken} from "./AssetToken.sol";
import {FeeConfig} from "./FeeConfig.sol";

/// @title Marketplace — secondary trading of asset shares between investors (liquidity).
/// @notice Listings are non-custodial: shares stay in the seller's wallet (and keep earning)
///         until someone buys them. Sellers approve this contract once.
contract Marketplace is FeeConfig, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Listing {
        address seller;
        uint256 assetId;
        uint256 shares; // remaining
        uint256 pricePerShare; // USDC (6 decimals)
        bool active;
    }

    IERC20 public immutable usdc;
    AssetToken public immutable token;
    Listing[] public listings;

    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed assetId, uint256 shares, uint256 pricePerShare);
    event Cancelled(uint256 indexed listingId);
    event Traded(uint256 indexed listingId, address indexed buyer, uint256 shares, uint256 cost, uint256 fee);

    error NotSeller();
    error ListingInactive();
    error NotEnoughShares(uint256 requested, uint256 available);

    constructor(address admin, IERC20 usdc_, AssetToken token_, address treasury_, uint16 feeBps_)
        FeeConfig(admin, treasury_, feeBps_)
    {
        usdc = usdc_;
        token = token_;
    }

    function list(uint256 assetId, uint256 shares, uint256 pricePerShare) external returns (uint256 listingId) {
        require(shares > 0 && pricePerShare > 0, "empty listing");
        uint256 balance = token.balanceOf(msg.sender, assetId);
        if (shares > balance) revert NotEnoughShares(shares, balance);
        require(token.isApprovedForAll(msg.sender, address(this)), "approve marketplace first");
        listingId = listings.length;
        listings.push(Listing(msg.sender, assetId, shares, pricePerShare, true));
        emit Listed(listingId, msg.sender, assetId, shares, pricePerShare);
    }

    function cancel(uint256 listingId) external {
        Listing storage l = listings[listingId];
        if (l.seller != msg.sender) revert NotSeller();
        if (!l.active) revert ListingInactive();
        l.active = false;
        emit Cancelled(listingId);
    }

    /// @notice Buy part or all of a listing. The fee is deducted from the seller's proceeds.
    function buy(uint256 listingId, uint256 shares) external nonReentrant {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingInactive();
        if (shares == 0 || shares > l.shares) revert NotEnoughShares(shares, l.shares);

        l.shares -= shares;
        if (l.shares == 0) l.active = false;

        uint256 cost = shares * l.pricePerShare;
        uint256 fee = feeOn(cost);
        usdc.safeTransferFrom(msg.sender, l.seller, cost - fee);
        usdc.safeTransferFrom(msg.sender, treasury, fee);
        token.safeTransferFrom(l.seller, msg.sender, l.assetId, shares, "");
        emit Traded(listingId, msg.sender, shares, cost, fee);
    }

    function listingCount() external view returns (uint256) {
        return listings.length;
    }
}
