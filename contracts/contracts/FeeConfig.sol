// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title FeeConfig — platform commission shared by primary and secondary markets.
/// @notice Bounded to the 0.5%–1.5% range from the business model; changed only by the multisig.
abstract contract FeeConfig is AccessControl {
    bytes32 public constant FEE_ADMIN_ROLE = keccak256("FEE_ADMIN_ROLE");
    uint16 public constant MIN_FEE_BPS = 50;
    uint16 public constant MAX_FEE_BPS = 150;

    uint16 public feeBps;
    address public immutable treasury;

    event FeeChanged(uint16 feeBps);

    constructor(address admin, address treasury_, uint16 feeBps_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FEE_ADMIN_ROLE, admin);
        treasury = treasury_;
        _setFee(feeBps_);
    }

    function setFee(uint16 feeBps_) external onlyRole(FEE_ADMIN_ROLE) {
        _setFee(feeBps_);
    }

    function feeOn(uint256 amount) public view returns (uint256) {
        return (amount * feeBps) / 10_000;
    }

    function _setFee(uint16 feeBps_) private {
        require(feeBps_ >= MIN_FEE_BPS && feeBps_ <= MAX_FEE_BPS, "fee out of range");
        feeBps = feeBps_;
        emit FeeChanged(feeBps_);
    }
}
