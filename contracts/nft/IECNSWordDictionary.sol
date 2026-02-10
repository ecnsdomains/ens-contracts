// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

interface IECNSWordDictionary {
    /// @notice Returns true if the word is in the English dictionary.
    function isWord(string memory word) external view returns (bool);

    /// @notice Returns true if the label is an iconic leetspeak form (e.g. "1337", "80085").
    function isIconicLeet(string memory label) external view returns (bool);

    /// @notice Returns true if the word is blacklisted (offensive content).
    function isBlacklisted(string memory word) external view returns (bool);
}
