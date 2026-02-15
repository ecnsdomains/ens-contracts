// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

interface IMysteryBoxRegistrar {
    enum BoxTier { Standard, Premium, Elite }

    event BoxCommitted(address indexed buyer, BoxTier tier, uint8 quantity, bytes32 commitHash);
    event BoxRevealed(address indexed buyer, BoxTier tier, string label, uint256 tokenId);
    event BatchRevealed(address indexed buyer, BoxTier tier, uint8 quantity, uint256[] tokenIds);
    event PoolSeeded(BoxTier tier, uint256 count, uint256 totalRemaining);
    event PoolLow(BoxTier tier, uint256 remaining);

    function commit(BoxTier tier, bytes32 secret) external;
    function reveal(BoxTier tier, bytes32 secret) external payable returns (string memory label, uint256 tokenId);

    function commitBatch(BoxTier tier, uint8 quantity, bytes32 secret) external;
    function revealBatch(BoxTier tier, uint8 quantity, bytes32 secret) external payable
        returns (string[] memory labels, uint256[] memory tokenIds);

    function getPrice(BoxTier tier, uint8 quantity) external view returns (uint256 etcAmount);
    function poolRemaining(BoxTier tier) external view returns (uint256);
}
