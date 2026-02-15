// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./IECNSMetadataRenderer.sol";
import "./IECNSWordDictionary.sol";
import "./ECNSSVG.sol";

/// @title ECNS Metadata Renderer
/// @notice Generates fully on-chain SVG artwork and metadata for ECNS .etc name NFTs.
///         Visual appearance (holographic gradient) is randomized per tokenId.
///         Metadata traits reflect actual TLD name value: Tier, Character Class, Fluency, Pattern.
///         Leetspeak detected via dictionary lookup (decode digits → check real word).
///         Iconic leet words (1337, 80085) get Ultra Rare; others match decoded length tier.
contract ECNSMetadataRenderer is IECNSMetadataRenderer, Ownable {
    using Strings for uint256;

    bytes16 private constant ALPHABET = '0123456789abcdef';

    /// @notice The word dictionary contract for leetspeak + blacklist lookups
    IECNSWordDictionary public dictionary;

    constructor(address _dictionary) {
        dictionary = IECNSWordDictionary(_dictionary);
    }

    function setDictionary(address _dictionary) external onlyOwner {
        dictionary = IECNSWordDictionary(_dictionary);
    }

    // =========================================================================
    // Main entry point
    // =========================================================================

    function tokenURI(
        uint256 tokenId,
        string memory label,
        uint256 expiry,
        bytes16 traits
    ) external view override returns (string memory) {
        string memory name = string(abi.encodePacked(label, ".etc"));
        bytes memory labelBytes = bytes(label);

        // Visual params from random traits (border, texture, glow)
        uint8 borderStyle = uint8(uint16(bytes2(traits << 32)) % 6);
        uint8 textureIdx  = uint8(uint16(bytes2(traits << 48)) % 6);
        uint8 glowColor   = uint8(uint16(bytes2(traits << 64)) % 7);

        // Name classification: detect leetspeak via dictionary
        (string memory charClass, bytes memory decoded) = _classifyLabel(labelBytes);
        bool isLeet = decoded.length > 0;
        bool isIconic = isLeet && dictionary.isIconicLeet(label);

        // Tier: iconic leet → Ultra Rare, otherwise based on effective length
        uint256 effectiveLen = isLeet ? decoded.length : labelBytes.length;
        string memory tier = _tierName(effectiveLen, isIconic);

        // Fluency: analyze decoded word for leet, original for non-leet
        string memory fluency = _analyzeFluency(isLeet ? decoded : labelBytes);

        string memory pattern = _analyzePattern(labelBytes);
        string memory chain = _chainName();
        string memory expiryDisplay = _expiryDisplay(expiry);

        // Sparkle for iconic leet, or short names (Legendary/Epic)
        bool isRare = isIconic || effectiveLen <= 4;

        string memory svg = _generateSVG(
            tokenId, name, labelBytes.length,
            borderStyle, textureIdx, glowColor, isRare,
            tier, charClass, fluency, pattern, chain, expiryDisplay
        );

        string memory attributes = _buildAttributes(
            tier, labelBytes.length, charClass, fluency, pattern, chain, expiry
        );

        string memory json = string(abi.encodePacked(
            '{"name":"', name,
            '","description":"ECNS Name Card \\u2014 a unique on-chain identity on Ethereum Classic.',
            '","image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)),
            '","animation_url":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)),
            '","attributes":[', attributes, ']}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    // =========================================================================
    // SVG generation
    // =========================================================================

    function _generateSVG(
        uint256 tokenId,
        string memory name,
        uint256 nameLen,
        uint8 borderStyle,
        uint8 textureIdx,
        uint8 glowColor,
        bool isRare,
        string memory tier,
        string memory charClass,
        string memory fluency,
        string memory pattern,
        string memory chain,
        string memory expiryDisplay
    ) internal pure returns (string memory) {
        // Brand-constrained palette: dark backgrounds + green phosphor circles
        string memory color0 = _bgPalette(_getCircleCoord(tokenId, 136) % 5);
        string memory color1 = _circlePalette(_getCircleCoord(tokenId, 112) % 12);
        string memory color2 = _circlePalette(_getCircleCoord(tokenId, 64) % 12);
        string memory color3 = _circlePalette(_getCircleCoord(tokenId, 32) % 12);

        ECNSSVG.SVGParams memory params = ECNSSVG.SVGParams({
            name: name,
            color0: color0,
            color1: color1,
            color2: color2,
            color3: color3,
            x1: _scale(_getCircleCoord(tokenId, 16), 0, 255, 16, 484),
            y1: _scale(_getCircleCoord(tokenId, 48), 0, 255, 16, 484),
            x2: _scale(_getCircleCoord(tokenId, 80), 0, 255, 16, 484),
            y2: _scale(_getCircleCoord(tokenId, 96), 0, 255, 16, 484),
            x3: _scale(_getCircleCoord(tokenId, 128), 0, 255, 16, 484),
            y3: _scale(_getCircleCoord(tokenId, 160), 0, 255, 16, 484),
            nameLength: nameLen,
            borderStyle: borderStyle,
            glowColor: glowColor,
            textureIdx: textureIdx,
            isRare: isRare,
            tier: tier,
            charClass: charClass,
            fluency: fluency,
            pattern: pattern,
            chain: chain,
            expiryDisplay: expiryDisplay
        });

        return ECNSSVG.generateSVG(params);
    }

    // =========================================================================
    // Brand-constrained color palettes
    // =========================================================================

    /// @dev 5 dark green backgrounds — Terminal Black to Deep Forest
    function _bgPalette(uint256 idx) internal pure returns (string memory) {
        if (idx == 0) return "0F1A15"; // Terminal Black
        if (idx == 1) return "0D3D2E"; // Shadow Green
        if (idx == 2) return "1A2A22"; // Surface Dark
        if (idx == 3) return "132F25"; // Dark Emerald
        return "0B2E22";               // Deep Forest
    }

    /// @dev 12 green phosphor shades for gradient circles
    function _circlePalette(uint256 idx) internal pure returns (string memory) {
        if (idx == 0) return "4FD4A4";  // Light Phosphor
        if (idx == 1) return "3FB68B";  // Green Phosphor (Primary)
        if (idx == 2) return "5EE0B2";  // Accent Hover
        if (idx == 3) return "2E9E76";  // Mid Green
        if (idx == 4) return "1A6B50";  // Deep Green
        if (idx == 5) return "45BF96";  // Mint
        if (idx == 6) return "3DD4A0";  // Neon Mint
        if (idx == 7) return "2CCFB2";  // Teal
        if (idx == 8) return "28A874";  // Classic Green
        if (idx == 9) return "1B9E85";  // Cyan Green
        if (idx == 10) return "0FA87A"; // Jade
        return "189068";                // Emerald Dark
    }

    // =========================================================================
    // Coordinate helpers
    // =========================================================================

    function _getCircleCoord(uint256 tokenId, uint256 offset) internal pure returns (uint256) {
        return uint256(uint8(tokenId >> (offset % 256)));
    }

    function _scale(
        uint256 n,
        uint256 inMn,
        uint256 inMx,
        uint256 outMn,
        uint256 outMx
    ) internal pure returns (string memory) {
        return ((n - inMn) * (outMx - outMn) / (inMx - inMn) + outMn).toString();
    }

    // =========================================================================
    // Name classification (Character Class + Leetspeak via dictionary)
    // =========================================================================

    /// @dev Returns (charClass, decodedWord). If decodedWord.length > 0, name is Leetspeak.
    function _classifyLabel(bytes memory b) internal view returns (
        string memory charClass,
        bytes memory decoded
    ) {
        bool hasAlpha;
        bool hasDigit;
        bool hasHyphen;

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c >= 0x61 && c <= 0x7A) hasAlpha = true;      // a-z
            else if (c >= 0x30 && c <= 0x39) hasDigit = true;  // 0-9
            else if (c == 0x2D) hasHyphen = true;              // -
        }

        if (hasHyphen) return ("Hyphenated", new bytes(0));

        if (hasDigit) {
            decoded = _tryLeetDecode(b);
            if (decoded.length > 0) return ("Leetspeak", decoded);
            return (hasAlpha ? "Alphanumeric" : "Numeric", new bytes(0));
        }

        return ("Pure Alpha", new bytes(0));
    }

    // =========================================================================
    // Leetspeak detection via dictionary
    // =========================================================================

    /// @dev Tries three decode strategies. Returns decoded word if found in dictionary, empty if not.
    function _tryLeetDecode(bytes memory b) internal view returns (bytes memory) {
        // Map A: standard leet, 1→l
        bytes memory d = _leetDecodeMapA(b, 0x6C); // 'l'
        if (_isAllAlpha(d) && dictionary.isWord(string(d))) return d;

        // Map A: standard leet, 1→i
        d = _leetDecodeMapA(b, 0x69); // 'i'
        if (_isAllAlpha(d) && dictionary.isWord(string(d))) return d;

        // Map B: calculator/visual leet
        d = _leetDecodeMapB(b);
        if (_isAllAlpha(d) && dictionary.isWord(string(d))) return d;

        return new bytes(0);
    }

    /// @dev Map A — Standard leet: 4→a, 3→e, 1→l/i, 0→o, 5→s, 7→t, 8→b
    function _leetDecodeMapA(bytes memory b, bytes1 oneAs) internal pure returns (bytes memory) {
        bytes memory result = new bytes(b.length);
        for (uint256 i = 0; i < b.length; i++) {
            result[i] = _leetSubA(b[i], oneAs);
        }
        return result;
    }

    function _leetSubA(bytes1 c, bytes1 oneAs) internal pure returns (bytes1) {
        if (c == 0x34) return 0x61; // 4→a
        if (c == 0x33) return 0x65; // 3→e
        if (c == 0x31) return oneAs; // 1→l or 1→i
        if (c == 0x30) return 0x6F; // 0→o
        if (c == 0x35) return 0x73; // 5→s
        if (c == 0x37) return 0x74; // 7→t
        if (c == 0x38) return 0x62; // 8→b
        return c;
    }

    /// @dev Map B — Calculator/visual leet: 4→h, 3→e, 7→l, 1→i, 0→o, 5→s, 8→b, 6→g, 9→g
    function _leetDecodeMapB(bytes memory b) internal pure returns (bytes memory) {
        bytes memory result = new bytes(b.length);
        for (uint256 i = 0; i < b.length; i++) {
            result[i] = _leetSubB(b[i]);
        }
        return result;
    }

    function _leetSubB(bytes1 c) internal pure returns (bytes1) {
        if (c == 0x34) return 0x68; // 4→h
        if (c == 0x33) return 0x65; // 3→e
        if (c == 0x31) return 0x69; // 1→i
        if (c == 0x30) return 0x6F; // 0→o
        if (c == 0x35) return 0x73; // 5→s
        if (c == 0x37) return 0x6C; // 7→l
        if (c == 0x38) return 0x62; // 8→b
        if (c == 0x36) return 0x67; // 6→g
        if (c == 0x39) return 0x67; // 9→g
        return c;
    }

    /// @dev Returns true if all bytes are lowercase a-z
    function _isAllAlpha(bytes memory b) internal pure returns (bool) {
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] < 0x61 || b[i] > 0x7A) return false;
        }
        return true;
    }

    // =========================================================================
    // Name analysis: Fluency
    // =========================================================================

    function _analyzeFluency(bytes memory b) internal pure returns (string memory) {
        uint256 len = b.length;
        if (len == 0) return "Standard";

        uint256 vowels;
        uint256 consonantRun;
        uint256 clusters;

        for (uint256 i = 0; i < len; i++) {
            if (_isVowel(b[i])) {
                vowels++;
                consonantRun = 0;
            } else if (b[i] >= 0x61 && b[i] <= 0x7A) {
                consonantRun++;
                if (consonantRun == 3) clusters++;
            } else {
                consonantRun = 0;
            }
        }

        uint256 ratio = (vowels * 100) / len;

        if (ratio < 15 || ratio > 65 || clusters >= 2) return "Harsh";
        if (ratio >= 35 && ratio <= 55 && clusters == 0) return "Euphonious";
        if (ratio >= 25 && ratio <= 60 && clusters <= 1) return "Fluent";
        return "Standard";
    }

    function _isVowel(bytes1 c) internal pure returns (bool) {
        return c == 0x61 || c == 0x65 || c == 0x69 || c == 0x6F || c == 0x75; // a,e,i,o,u
    }

    // =========================================================================
    // Name analysis: Pattern
    // =========================================================================

    function _analyzePattern(bytes memory b) internal pure returns (string memory) {
        uint256 len = b.length;
        if (len < 2) return "Standard";

        // Palindrome
        bool isPalin = true;
        for (uint256 i = 0; i < len / 2; i++) {
            if (b[i] != b[len - 1 - i]) { isPalin = false; break; }
        }
        if (isPalin) return "Palindrome";

        // Repeating (all same char)
        bool allSame = true;
        for (uint256 i = 1; i < len; i++) {
            if (b[i] != b[0]) { allSame = false; break; }
        }
        if (allSame) return "Repeating";

        // Repeating (2-char pattern: "abab")
        if (len >= 4) {
            uint256 half = len / 2;
            bool isRepeat = true;
            for (uint256 i = 0; i < len; i++) {
                if (b[i] != b[i % half]) { isRepeat = false; break; }
            }
            if (isRepeat) return "Repeating";
        }

        // Sequential (abc, 123)
        bool isSeq = true;
        for (uint256 i = 1; i < len; i++) {
            if (uint8(b[i]) != uint8(b[i - 1]) + 1) { isSeq = false; break; }
        }
        if (isSeq) return "Sequential";

        // Reverse sequential (zyx, 987)
        bool isRevSeq = true;
        for (uint256 i = 1; i < len; i++) {
            if (uint8(b[i]) + 1 != uint8(b[i - 1])) { isRevSeq = false; break; }
        }
        if (isRevSeq) return "Sequential";

        return "Standard";
    }

    // =========================================================================
    // Name analysis: Tier
    // =========================================================================

    /// @param nameLen The effective name length (decoded length for leet, label length otherwise)
    /// @param isIconic True if the name is an iconic leetspeak form → Ultra Rare override
    function _tierName(uint256 nameLen, bool isIconic) internal pure returns (string memory) {
        if (nameLen <= 2 || isIconic) return "Ultra Rare";
        if (nameLen == 3) return "Legendary";
        if (nameLen == 4) return "Epic";
        if (nameLen <= 7) return "Rare";
        if (nameLen <= 9) return "Uncommon";
        return "Common";
    }

    // =========================================================================
    // Chain name (dynamic from block.chainid)
    // =========================================================================

    function _chainName() internal view returns (string memory) {
        if (block.chainid == 61) return "ETC";
        if (block.chainid == 63) return "Mordor";
        return block.chainid.toString();
    }

    // =========================================================================
    // Expiry display
    // =========================================================================

    function _expiryDisplay(uint256 expiry) internal view returns (string memory) {
        if (block.timestamp >= expiry) return "Expired";
        uint256 remaining = expiry - block.timestamp;
        uint256 days_ = remaining / 86400;
        return string(abi.encodePacked(days_.toString(), "d"));
    }

    // =========================================================================
    // JSON Attributes
    // =========================================================================

    function _buildAttributes(
        string memory tier,
        uint256 nameLen,
        string memory charClass,
        string memory fluency,
        string memory pattern,
        string memory chain,
        uint256 expiry
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '{"trait_type":"Tier","value":"', tier, '"},',
            '{"trait_type":"Name Length","display_type":"number","value":', nameLen.toString(), '},',
            '{"trait_type":"Character Class","value":"', charClass, '"},',
            '{"trait_type":"Fluency","value":"', fluency, '"},',
            _attributesTail(pattern, chain, expiry)
        ));
    }

    function _attributesTail(
        string memory pattern,
        string memory chain,
        uint256 expiry
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '{"trait_type":"Pattern","value":"', pattern, '"},',
            '{"trait_type":"Chain","value":"', chain, '"},',
            '{"display_type":"date","trait_type":"Registration Expires","value":', expiry.toString(), '}'
        ));
    }
}
