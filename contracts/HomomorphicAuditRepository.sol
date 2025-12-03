// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HomomorphicAuditRepository is SepoliaConfig {

    /// @notice Structure for encrypted submissions from users
    struct EncryptedSubmission {
        uint256 id;
        euint32 encryptedData;       // Encrypted sensitive data
        euint32 encryptedMetadata;   // Encrypted metadata (e.g., category, type)
        uint256 timestamp;
        address submitter;           // User submitting data
    }

    /// @notice Structure for decrypted data (after authorized reveal)
    struct DecryptedSubmission {
        string data;
        string metadata;
        bool isRevealed;
    }

    /// @notice Supply chain participant record with confidential proof
    struct SupplyChainRecord {
        address participant;
        bytes32 proofOfParticipation;  // Confidential proof (hash/signature)
        uint256 timestamp;
    }

    uint256 public submissionCount;

    mapping(uint256 => EncryptedSubmission) public encryptedSubmissions;
    mapping(uint256 => DecryptedSubmission) public decryptedSubmissions;
    
    // Supply chain tracking per submission
    mapping(uint256 => SupplyChainRecord[]) public supplyChainRecords;

    // Encrypted statistics counters per metadata
    mapping(string => euint32) private encryptedMetadataCount;
    string[] private metadataList;

    // Track decryption requests
    mapping(uint256 => uint256) private requestToSubmissionId;

    // Events
    event SubmissionEncrypted(uint256 indexed id, address indexed submitter, uint256 timestamp);
    event DecryptionRequested(uint256 indexed submissionId);
    event SubmissionDecrypted(uint256 indexed submissionId);
    event SupplyChainRecorded(uint256 indexed submissionId, address participant);

    /// @notice Modifier to restrict actions to submitter
    modifier onlySubmitter(uint256 submissionId) {
        require(msg.sender == encryptedSubmissions[submissionId].submitter, "Not the submitter");
        _;
    }

    /// @notice Submit new encrypted data
    function submitEncryptedData(
        euint32 encryptedData,
        euint32 encryptedMetadata
    ) public {
        submissionCount += 1;
        uint256 newId = submissionCount;

        encryptedSubmissions[newId] = EncryptedSubmission({
            id: newId,
            encryptedData: encryptedData,
            encryptedMetadata: encryptedMetadata,
            timestamp: block.timestamp,
            submitter: msg.sender
        });

        decryptedSubmissions[newId] = DecryptedSubmission({
            data: "",
            metadata: "",
            isRevealed: false
        });

        emit SubmissionEncrypted(newId, msg.sender, block.timestamp);
    }

    /// @notice Request decryption of encrypted data
    function requestDecryption(uint256 submissionId) public onlySubmitter(submissionId) {
        EncryptedSubmission storage submission = encryptedSubmissions[submissionId];
        require(!decryptedSubmissions[submissionId].isRevealed, "Already decrypted");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(submission.encryptedData);
        ciphertexts[1] = FHE.toBytes32(submission.encryptedMetadata);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptSubmission.selector);
        requestToSubmissionId[reqId] = submissionId;

        emit DecryptionRequested(submissionId);
    }

    /// @notice Callback for decrypted submission
    function decryptSubmission(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 submissionId = requestToSubmissionId[requestId];
        require(submissionId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory results = abi.decode(cleartexts, (string[]));

        DecryptedSubmission storage dSub = decryptedSubmissions[submissionId];
        dSub.data = results[0];
        dSub.metadata = results[1];
        dSub.isRevealed = true;

        // Update encrypted metadata counters
        if (!FHE.isInitialized(encryptedMetadataCount[dSub.metadata])) {
            encryptedMetadataCount[dSub.metadata] = FHE.asEuint32(0);
            metadataList.push(dSub.metadata);
        }
        encryptedMetadataCount[dSub.metadata] = FHE.add(
            encryptedMetadataCount[dSub.metadata],
            FHE.asEuint32(1)
        );

        emit SubmissionDecrypted(submissionId);
    }

    /// @notice Add supply chain participation record
    function addSupplyChainRecord(
        uint256 submissionId,
        bytes32 proofOfParticipation
    ) public {
        supplyChainRecords[submissionId].push(SupplyChainRecord({
            participant: msg.sender,
            proofOfParticipation: proofOfParticipation,
            timestamp: block.timestamp
        }));
        emit SupplyChainRecorded(submissionId, msg.sender);
    }

    /// @notice Get decrypted submission data
    function getDecryptedSubmission(uint256 submissionId) public view returns (
        string memory data,
        string memory metadata,
        bool isRevealed
    ) {
        DecryptedSubmission storage s = decryptedSubmissions[submissionId];
        return (s.data, s.metadata, s.isRevealed);
    }

    /// @notice Get encrypted metadata count
    function getEncryptedMetadataCount(string memory metadata) public view returns (euint32) {
        return encryptedMetadataCount[metadata];
    }

    /// @notice Request decryption of metadata count
    function requestMetadataCountDecryption(string memory metadata) public {
        euint32 count = encryptedMetadataCount[metadata];
        require(FHE.isInitialized(count), "Metadata not found");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptMetadataCount.selector);
        requestToSubmissionId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(metadata)));
    }

    /// @notice Callback for decrypted metadata count
    function decryptMetadataCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 metadataHash = requestToSubmissionId[requestId];
        string memory metadata = getMetadataFromHash(metadataHash);

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 count = abi.decode(cleartexts, (uint32));
        // Decrypted count can be processed or emitted as needed
    }

    /// @notice Helper: convert bytes32 to uint256
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    /// @notice Helper: retrieve metadata from hash
    function getMetadataFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < metadataList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(metadataList[i]))) == hash) {
                return metadataList[i];
            }
        }
        revert("Metadata not found");
    }
}
