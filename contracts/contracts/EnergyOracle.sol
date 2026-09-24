// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title EnergyOracle — tamper-evident record of metered production.
/// @notice The platform anchors each hourly batch of verified IoT readings: energy produced,
///         a hash of the raw readings (anyone can recompute it), and the AI verdict.
contract EnergyOracle is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    struct Batch {
        uint256 assetId;
        uint64 periodStart; // unix seconds, simulated time
        uint64 periodEnd;
        uint256 energyWh;
        bytes32 dataHash; // sha256 of the batch's canonical readings
        uint16 anomalyScore; // 0..10000 (basis points of anomaly probability)
        bool flagged; // AI verdict: true = suspicious, revenue goes to escrow
        uint64 recordedAt;
    }

    Batch[] private _batches;
    mapping(uint256 => uint256) public lastPeriodEnd; // assetId -> latest anchored period

    event BatchRecorded(
        uint256 indexed batchId,
        uint256 indexed assetId,
        uint64 periodStart,
        uint64 periodEnd,
        uint256 energyWh,
        bytes32 dataHash,
        uint16 anomalyScore,
        bool flagged
    );

    constructor(address admin, address oracle) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_ROLE, oracle);
    }

    function recordBatch(
        uint256 assetId,
        uint64 periodStart,
        uint64 periodEnd,
        uint256 energyWh,
        bytes32 dataHash,
        uint16 anomalyScore,
        bool flagged
    ) external onlyRole(ORACLE_ROLE) returns (uint256 batchId) {
        require(periodEnd > periodStart, "bad period");
        require(periodStart >= lastPeriodEnd[assetId], "overlapping period");
        require(anomalyScore <= 10000, "bad score");
        lastPeriodEnd[assetId] = periodEnd;
        batchId = _batches.length;
        _batches.push(
            Batch(assetId, periodStart, periodEnd, energyWh, dataHash, anomalyScore, flagged, uint64(block.timestamp))
        );
        emit BatchRecorded(batchId, assetId, periodStart, periodEnd, energyWh, dataHash, anomalyScore, flagged);
    }

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    function batchCount() external view returns (uint256) {
        return _batches.length;
    }
}
