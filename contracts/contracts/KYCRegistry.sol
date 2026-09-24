// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title KYCRegistry — wallets allowed to hold asset shares (security-token compliance).
contract KYCRegistry is AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    mapping(address => bool) private _verified;

    event Verified(address indexed account);
    event Revoked(address indexed account);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);
    }

    function isVerified(address account) external view returns (bool) {
        return _verified[account];
    }

    function verify(address account) external onlyRole(VERIFIER_ROLE) {
        _verified[account] = true;
        emit Verified(account);
    }

    function revoke(address account) external onlyRole(VERIFIER_ROLE) {
        _verified[account] = false;
        emit Revoked(account);
    }
}
