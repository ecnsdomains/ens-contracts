//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

interface IECNSMetadataRenderer {
    /// @notice Returns the token URI for a given token.
    /// @param tokenId The token ID.
    /// @param label The name label (e.g. "alice" for alice.etc).
    /// @param expiry The expiry timestamp.
    /// @param traits The trait bytes (bytes16) for the token.
    function tokenURI(
        uint256 tokenId,
        string memory label,
        uint256 expiry,
        bytes16 traits
    ) external view returns (string memory);
}
