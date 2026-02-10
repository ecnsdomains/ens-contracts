// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IECNSWordDictionary.sol";

/// @title ECNS Word Dictionary
/// @notice Stores three on-chain word sets for the ECNS name system:
///   1. English dictionary words — used to verify leetspeak decodings
///   2. Iconic leet forms — culturally legendary leet words that get Ultra Rare tier
///   3. Blacklisted words — offensive content blocked at registration
/// @dev Words are stored as keccak256 hashes in mappings for gas-efficient lookups.
///      Persists independently of renderer upgrades.
contract ECNSWordDictionary is IECNSWordDictionary, Ownable {
    /// @notice keccak256(lowercase word) => true for valid English words
    mapping(bytes32 => bool) private _words;

    /// @notice keccak256(original leet form) => true for iconic leet words
    mapping(bytes32 => bool) private _iconicLeet;

    /// @notice keccak256(lowercase word) => true for offensive/blocked words
    mapping(bytes32 => bool) private _blacklist;

    /// @notice Total count of words in each set (for informational purposes)
    uint256 public wordCount;
    uint256 public iconicLeetCount;
    uint256 public blacklistCount;

    event WordsAdded(uint256 count);
    event WordsRemoved(uint256 count);
    event IconicLeetAdded(uint256 count);
    event IconicLeetRemoved(uint256 count);
    event BlacklistAdded(uint256 count);
    event BlacklistRemoved(uint256 count);

    constructor() {}

    // =========================================================================
    // Read functions
    // =========================================================================

    function isWord(string memory word) external view override returns (bool) {
        return _words[keccak256(bytes(word))];
    }

    function isIconicLeet(string memory label) external view override returns (bool) {
        return _iconicLeet[keccak256(bytes(label))];
    }

    function isBlacklisted(string memory word) external view override returns (bool) {
        return _blacklist[keccak256(bytes(word))];
    }

    // =========================================================================
    // Write functions — Words
    // =========================================================================

    function addWords(string[] calldata words) external onlyOwner {
        for (uint256 i = 0; i < words.length; i++) {
            bytes32 hash = keccak256(bytes(words[i]));
            if (!_words[hash]) {
                _words[hash] = true;
                wordCount++;
            }
        }
        emit WordsAdded(words.length);
    }

    function removeWords(string[] calldata words) external onlyOwner {
        for (uint256 i = 0; i < words.length; i++) {
            bytes32 hash = keccak256(bytes(words[i]));
            if (_words[hash]) {
                _words[hash] = false;
                wordCount--;
            }
        }
        emit WordsRemoved(words.length);
    }

    // =========================================================================
    // Write functions — Iconic Leet
    // =========================================================================

    function addIconicLeet(string[] calldata labels) external onlyOwner {
        for (uint256 i = 0; i < labels.length; i++) {
            bytes32 hash = keccak256(bytes(labels[i]));
            if (!_iconicLeet[hash]) {
                _iconicLeet[hash] = true;
                iconicLeetCount++;
            }
        }
        emit IconicLeetAdded(labels.length);
    }

    function removeIconicLeet(string[] calldata labels) external onlyOwner {
        for (uint256 i = 0; i < labels.length; i++) {
            bytes32 hash = keccak256(bytes(labels[i]));
            if (_iconicLeet[hash]) {
                _iconicLeet[hash] = false;
                iconicLeetCount--;
            }
        }
        emit IconicLeetRemoved(labels.length);
    }

    // =========================================================================
    // Write functions — Blacklist
    // =========================================================================

    function addBlacklist(string[] calldata words) external onlyOwner {
        for (uint256 i = 0; i < words.length; i++) {
            bytes32 hash = keccak256(bytes(words[i]));
            if (!_blacklist[hash]) {
                _blacklist[hash] = true;
                blacklistCount++;
            }
        }
        emit BlacklistAdded(words.length);
    }

    function removeBlacklist(string[] calldata words) external onlyOwner {
        for (uint256 i = 0; i < words.length; i++) {
            bytes32 hash = keccak256(bytes(words[i]));
            if (_blacklist[hash]) {
                _blacklist[hash] = false;
                blacklistCount--;
            }
        }
        emit BlacklistRemoved(words.length);
    }
}
