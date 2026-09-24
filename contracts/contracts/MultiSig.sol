// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MultiSig — M-of-N approval for critical platform actions.
/// @notice Holds the admin roles: releasing or refunding escrowed revenue, pausing trading,
///         changing fees. A proposal executes automatically when it reaches the threshold.
contract MultiSig {
    struct Proposal {
        address target;
        uint256 value;
        bytes data;
        string description;
        bool executed;
        uint256 approvals;
    }

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public immutable threshold;
    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) public approved;

    event Proposed(uint256 indexed id, address indexed proposer, address target, string description);
    event Approved(uint256 indexed id, address indexed owner);
    event Revoked(uint256 indexed id, address indexed owner);
    event Executed(uint256 indexed id);

    error NotOwner();
    error AlreadyApproved();
    error NotApproved();
    error AlreadyExecuted();
    error ExecutionFailed(bytes reason);

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    constructor(address[] memory owners_, uint256 threshold_) {
        require(threshold_ > 0 && threshold_ <= owners_.length, "bad threshold");
        for (uint256 i = 0; i < owners_.length; i++) {
            require(owners_[i] != address(0) && !isOwner[owners_[i]], "bad owner");
            isOwner[owners_[i]] = true;
            owners.push(owners_[i]);
        }
        threshold = threshold_;
    }

    /// @notice Propose an action; the proposer's approval counts immediately.
    function propose(address target, uint256 value, bytes calldata data, string calldata description)
        external
        onlyOwner
        returns (uint256 id)
    {
        id = _proposals.length;
        _proposals.push(Proposal(target, value, data, description, false, 0));
        emit Proposed(id, msg.sender, target, description);
        _approve(id);
    }

    function approve(uint256 id) external onlyOwner {
        _approve(id);
    }

    function revoke(uint256 id) external onlyOwner {
        Proposal storage p = _proposals[id];
        if (p.executed) revert AlreadyExecuted();
        if (!approved[id][msg.sender]) revert NotApproved();
        approved[id][msg.sender] = false;
        p.approvals -= 1;
        emit Revoked(id, msg.sender);
    }

    function _approve(uint256 id) private {
        Proposal storage p = _proposals[id];
        if (p.executed) revert AlreadyExecuted();
        if (approved[id][msg.sender]) revert AlreadyApproved();
        approved[id][msg.sender] = true;
        p.approvals += 1;
        emit Approved(id, msg.sender);
        if (p.approvals >= threshold) {
            p.executed = true;
            (bool ok, bytes memory reason) = p.target.call{value: p.value}(p.data);
            if (!ok) revert ExecutionFailed(reason);
            emit Executed(id);
        }
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        return _proposals[id];
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    receive() external payable {}
}
