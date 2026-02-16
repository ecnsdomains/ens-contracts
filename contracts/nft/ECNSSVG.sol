// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @title ECNSSVG
/// @notice Generates on-chain SVG artwork for ECNS .etc name NFTs.
///         Terminal-first aesthetic with green phosphor holographic gradients,
///         CRT scanlines, diamond prism mark, and brand-constrained palette.
library ECNSSVG {
    using Strings for uint256;

    string private constant FONT = "'IBM Plex Mono', 'Courier New', monospace";

    struct SVGParams {
        string name;          // Full name with .etc (e.g. "alice.etc")
        string color0;        // Background base color (6 hex chars)
        string color1;        // Gradient circle 1
        string color2;        // Gradient circle 2
        string color3;        // Gradient circle 3
        string x1;
        string y1;
        string x2;
        string y2;
        string x3;
        string y3;
        uint256 nameLength;   // Character count of label
        uint8 borderStyle;    // 0-5
        uint8 glowColor;      // 0-6
        uint8 textureIdx;     // 0-5
        bool isRare;          // sparkle for Ultra Rare / Legendary / Epic
        string tier;          // "Ultra Rare", "Legendary", "Epic", "Rare", "Uncommon", "Common"
        string charClass;     // "Pure Alpha", "Leetspeak", "Alphanumeric", "Numeric", "Hyphenated"
        string fluency;       // "Euphonious", "Fluent", "Standard", "Harsh"
        string pattern;       // "Palindrome", "Repeating", "Sequential", "Standard"
        string chain;         // "Ethereum Classic" or "Mordor Testnet"
        string expiryDisplay; // "342d" or "Expired"
        string grade;         // "7.5" or "10.0"
        uint8 gradeColorTier; // 0-4 (badge background color)
    }

    // =========================================================================
    // Main entry
    // =========================================================================

    function generateSVG(SVGParams memory params) internal pure returns (string memory) {
        return string(abi.encodePacked(
            _generateDefs(params),
            _generateBackground(params),
            _diamondMark(),
            _generateBorderText(params.name),
            _generateCardMantle(params),
            _generateDataBadges(params),
            _generateCornerInfo(params),
            _generateGradeBadge(params.grade, params.gradeColorTier),
            params.isRare ? _rareSparkleSvg() : "",
            '</svg>'
        ));
    }

    // =========================================================================
    // SVG Defs: filter chain, clip paths, vignette gradient
    // =========================================================================

    function _generateDefs(SVGParams memory params) private pure returns (string memory) {
        return string(abi.encodePacked(
            '<svg width="500" height="500" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg"'
            " xmlns:xlink='http://www.w3.org/1999/xlink'>"
            '<defs>'
            '<filter id="f1"><feImage result="p0" xlink:href="data:image/svg+xml;base64,',
            Base64.encode(bytes(string(abi.encodePacked(
                "<svg width='500' height='500' viewBox='0 0 500 500' xmlns='http://www.w3.org/2000/svg'>"
                "<rect width='500' height='500' fill='#", params.color0, "'/></svg>"
            )))),
            '"/><feImage result="p1" xlink:href="data:image/svg+xml;base64,',
            _circleImage(params.x1, params.y1, "120", params.color1),
            '"/><feImage result="p2" xlink:href="data:image/svg+xml;base64,',
            _circleImage(params.x2, params.y2, "120", params.color2),
            '"/><feImage result="p3" xlink:href="data:image/svg+xml;base64,',
            _circleImage(params.x3, params.y3, "100", params.color3),
            _defsEnd()
        ));
    }

    function _circleImage(
        string memory cx, string memory cy,
        string memory r, string memory color
    ) private pure returns (string memory) {
        return Base64.encode(bytes(string(abi.encodePacked(
            "<svg width='500' height='500' viewBox='0 0 500 500' xmlns='http://www.w3.org/2000/svg'>"
            "<circle cx='", cx, "' cy='", cy, "' r='", r, "px' fill='#", color, "' opacity='0.6'/></svg>"
        ))));
    }

    function _defsEnd() private pure returns (string memory) {
        return string(abi.encodePacked(
            '"/>'
            '<feBlend mode="overlay" in="p0" in2="p1"/>'
            '<feBlend mode="soft-light" in2="p2"/>'
            '<feBlend mode="overlay" in2="p3" result="blendOut"/>'
            '<feGaussianBlur in="blendOut" stdDeviation="28"/>'
            '</filter>'
            '<clipPath id="corners"><rect width="500" height="500" rx="42" ry="42"/></clipPath>'
            '<path id="text-path-a" d="M40 12 H460 A28 28 0 0 1 488 40 V460 A28 28 0 0 1 460 488 H40 A28 28 0 0 1 12 460 V40 A28 28 0 0 1 40 12 z"/>'
            '<filter id="top-region-blur"><feGaussianBlur in="SourceGraphic" stdDeviation="24"/></filter>'
            '<radialGradient id="vignette" cx="50%" cy="50%" r="60%">'
            '<stop offset="50%" stop-color="transparent"/>'
            '<stop offset="100%" stop-color="rgba(0,0,0,0.35)"/>'
            '</radialGradient>'
            '</defs>'
        ));
    }

    // =========================================================================
    // Background: base color + holographic filter + vignette + CRT + border
    // =========================================================================

    function _generateBackground(SVGParams memory params) private pure returns (string memory) {
        (string memory borderStroke, string memory accentStroke) = _borderPalette(params.borderStyle);
        return string(abi.encodePacked(
            _outerGlow(params.glowColor),
            '<g clip-path="url(#corners)">'
            '<rect fill="#', params.color0, '" x="0" y="0" width="500" height="500"/>'
            '<rect style="filter: url(#f1)" x="0" y="0" width="500" height="500"/>'
            '<g style="filter:url(#top-region-blur); transform:scale(1.5); transform-origin:center top;">'
            '<rect fill="none" x="0" y="0" width="500" height="500"/>'
            '<ellipse cx="50%" cy="0px" rx="280px" ry="120px" fill="#000" opacity="0.85"/>'
            '</g>',
            _textureSvg(params.textureIdx),
            _bgEnd(borderStroke, accentStroke)
        ));
    }

    function _bgEnd(string memory borderStroke, string memory accentStroke) private pure returns (string memory) {
        return string(abi.encodePacked(
            '<rect width="500" height="500" fill="url(#vignette)" rx="42" ry="42"/>'
            '<rect x="0" y="0" width="500" height="500" rx="42" ry="42" fill="rgba(0,0,0,0)" stroke="', borderStroke, '"/>'
            '</g>'
            '<rect x="16" y="16" width="468" height="468" rx="26" ry="26" fill="rgba(0,0,0,0)" stroke="', accentStroke, '"/>'
        ));
    }

    function _outerGlow(uint8 idx) private pure returns (string memory) {
        string memory color = _glowColorHex(idx);
        if (bytes(color).length == 0) return "";
        return string(abi.encodePacked(
            '<rect x="-4" y="-4" width="508" height="508" rx="46" ry="46" fill="none" stroke="',
            color, '" stroke-width="2" opacity=".15">'
            '<animate attributeName="opacity" values=".1;.25;.1" dur="3s" repeatCount="indefinite"/>'
            '</rect>'
        ));
    }

    function _glowColorHex(uint8 idx) private pure returns (string memory) {
        if (idx == 0) return "#4FD4A4"; // Light Phosphor
        if (idx == 1) return "#3FB68B"; // Green Phosphor
        if (idx == 2) return "#5EE0B2"; // Bright Phosphor
        if (idx == 3) return "#2E9E76"; // Mid Green
        if (idx == 4) return "#2CCFB2"; // Teal Phosphor
        if (idx == 5) return "#45BF96"; // Mint
        return ""; // 6 = none
    }

    function _borderPalette(uint8 idx) private pure returns (string memory stroke, string memory accent) {
        if (idx == 0) return ("rgba(63,182,139,0.20)", "rgba(63,182,139,0.12)");
        if (idx == 1) return ("rgba(63,182,139,0.30)", "rgba(63,182,139,0.18)");
        if (idx == 2) return ("rgba(79,212,164,0.30)", "rgba(79,212,164,0.18)");
        if (idx == 3) return ("rgba(46,158,118,0.25)", "rgba(46,158,118,0.15)");
        if (idx == 4) return ("rgba(94,224,178,0.25)", "rgba(94,224,178,0.15)");
        return ("rgba(44,207,178,0.25)", "rgba(44,207,178,0.15)");
    }

    // =========================================================================
    // Textures: CRT scanlines + green-tinted patterns
    // =========================================================================

    function _textureSvg(uint8 idx) private pure returns (string memory) {
        // idx 0: CRT scanlines (signature terminal effect)
        if (idx == 0) return
            '<defs><pattern id="tex" width="4" height="2" patternUnits="userSpaceOnUse">'
            '<line x1="0" y1="0" x2="4" y2="0" stroke="#000" stroke-width="1" opacity=".06"/>'
            '</pattern></defs><rect width="500" height="500" fill="url(#tex)"/>';
        if (idx == 1) return
            '<defs><pattern id="tex" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
            '<line x1="0" y1="0" x2="12" y2="0" stroke="#3FB68B" stroke-width=".5" opacity=".06"/>'
            '<line x1="0" y1="0" x2="0" y2="12" stroke="#3FB68B" stroke-width=".5" opacity=".06"/>'
            '</pattern></defs><rect width="500" height="500" fill="url(#tex)"/>';
        if (idx == 2) return
            '<defs><pattern id="tex" width="16" height="16" patternUnits="userSpaceOnUse">'
            '<circle cx="8" cy="8" r="1.5" fill="#3FB68B" opacity=".05"/>'
            '</pattern></defs><rect width="500" height="500" fill="url(#tex)"/>';
        if (idx == 3) return
            '<defs><pattern id="tex" width="20" height="8" patternUnits="userSpaceOnUse">'
            '<line x1="0" y1="4" x2="20" y2="4" stroke="#3FB68B" stroke-width=".5" opacity=".05"/>'
            '</pattern></defs><rect width="500" height="500" fill="url(#tex)"/>';
        if (idx == 4) return
            '<defs><pattern id="tex" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
            '<rect width="8" height="8" fill="#3FB68B" opacity=".03"/>'
            '</pattern></defs><rect width="500" height="500" fill="url(#tex)"/>';
        return
            '<defs><pattern id="tex" width="24" height="24" patternUnits="userSpaceOnUse">'
            '<line x1="0" y1="12" x2="12" y2="12" stroke="#3FB68B" stroke-width=".4" opacity=".05"/>'
            '<line x1="12" y1="0" x2="12" y2="12" stroke="#3FB68B" stroke-width=".4" opacity=".05"/>'
            '<circle cx="12" cy="12" r="1.5" fill="#4FD4A4" opacity=".06"/>'
            '</pattern></defs><rect width="500" height="500" fill="url(#tex)"/>';
    }

    // =========================================================================
    // Diamond prism mark (top-left) — brand identity on every card
    // =========================================================================

    function _diamondMark() private pure returns (string memory) {
        return
            '<g style="transform:translate(30px, 28px) scale(0.3)" opacity="0.7">'
            '<polygon points="40,2 70,50 40,98 10,50" fill="#0D3D2E"/>'
            '<polygon points="40,2 15,42 40,42" fill="#4FD4A4"/>'
            '<polygon points="15,42 10,50 40,50 40,42" fill="#3FB68B"/>'
            '<polygon points="10,50 15,58 40,58 40,50" fill="#3FB68B"/>'
            '<polygon points="15,58 40,98 40,58" fill="#4FD4A4"/>'
            '<polygon points="40,2 65,42 40,42" fill="#1A6B50"/>'
            '<polygon points="65,42 70,50 40,50 40,42" fill="#0D3D2E"/>'
            '<polygon points="70,50 65,58 40,58 40,50" fill="#1A6B50"/>'
            '<polygon points="65,58 40,98 40,58" fill="#2E9E76"/>'
            '</g>';
    }

    // =========================================================================
    // Animated border text — green phosphor
    // =========================================================================

    function _generateBorderText(string memory name) private pure returns (string memory) {
        return string(abi.encodePacked(
            '<text text-rendering="optimizeSpeed">'
            '<textPath startOffset="-100%" fill="#4FD4A4" font-family="', FONT, '" font-size="10px" xlink:href="#text-path-a">',
            name,
            unicode' \u2022 ethereum classic name service',
            ' <animate additive="sum" attributeName="startOffset" from="0%" to="100%" begin="0s" dur="30s" repeatCount="indefinite"/>'
            '</textPath>'
            '<textPath startOffset="0%" fill="#4FD4A4" font-family="', FONT, '" font-size="10px" xlink:href="#text-path-a">',
            name,
            unicode' \u2022 ethereum classic name service',
            ' <animate additive="sum" attributeName="startOffset" from="0%" to="100%" begin="0s" dur="30s" repeatCount="indefinite"/>'
            '</textPath>',
            _borderTextSecondHalf()
        ));
    }

    function _borderTextSecondHalf() private pure returns (string memory) {
        return string(abi.encodePacked(
            '<textPath startOffset="50%" fill="#4FD4A4" font-family="', FONT, '" font-size="10px" xlink:href="#text-path-a">',
            unicode'ecns \u2022 .etc \u2022 on-chain identity',
            ' <animate additive="sum" attributeName="startOffset" from="0%" to="100%" begin="0s" dur="30s" repeatCount="indefinite"/>'
            '</textPath>'
            '<textPath startOffset="-50%" fill="#4FD4A4" font-family="', FONT, '" font-size="10px" xlink:href="#text-path-a">',
            unicode'ecns \u2022 .etc \u2022 on-chain identity',
            ' <animate additive="sum" attributeName="startOffset" from="0%" to="100%" begin="0s" dur="30s" repeatCount="indefinite"/>'
            '</textPath></text>'
        ));
    }

    // =========================================================================
    // Card mantle: large name display + ECNS branding
    // =========================================================================

    function _generateCardMantle(SVGParams memory params) private pure returns (string memory) {
        string memory fontSize = _nameFontSize(params.nameLength);
        return string(abi.encodePacked(
            '<text y="230" x="250" text-anchor="middle" fill="white" font-family="', FONT, '" font-weight="200" font-size="',
            fontSize,
            'px">',
            params.name,
            '</text>'
            '<text y="270" x="250" text-anchor="middle" fill="#3FB68B" opacity=".5" font-family="', FONT, '" font-size="12px" font-weight="bold" letter-spacing="3">ecns</text>'
        ));
    }

    /// @dev Dynamic font size based on total display length (label + ".etc")
    function _nameFontSize(uint256 nameLen) private pure returns (string memory) {
        uint256 totalChars = nameLen + 4;
        if (totalChars <= 7) return "72";
        if (totalChars <= 8) return "64";
        if (totalChars <= 10) return "48";
        if (totalChars <= 13) return "36";
        if (totalChars <= 18) return "28";
        return "22";
    }

    // =========================================================================
    // Data badges (bottom-left) — Tier, Class, Fluency, Pattern
    // =========================================================================

    function _generateDataBadges(SVGParams memory params) private pure returns (string memory) {
        // Fixed 28px spacing: y=388, 416, 444, optional 466
        bytes memory patternBytes = bytes(params.pattern);
        bool showPattern = patternBytes.length > 0 && keccak256(patternBytes) != keccak256("Standard");

        if (showPattern) {
            return string(abi.encodePacked(
                _dataBadge("388", "Tier: ", params.tier),
                _dataBadge("416", "Class: ", params.charClass),
                _dataBadge("444", "Fluency: ", params.fluency),
                _dataBadge("466", "Pattern: ", params.pattern)
            ));
        }
        return string(abi.encodePacked(
            _dataBadge("388", "Tier: ", params.tier),
            _dataBadge("416", "Class: ", params.charClass),
            _dataBadge("444", "Fluency: ", params.fluency)
        ));
    }

    function _dataBadge(string memory yPos, string memory labelText, string memory valueText) private pure returns (string memory) {
        uint256 width = 7 * (bytes(labelText).length + bytes(valueText).length + 4);
        return string(abi.encodePacked(
            '<g style="transform:translate(29px, ', yPos, 'px)">'
            '<rect width="', width.toString(), 'px" height="26px" rx="8px" ry="8px" fill="rgba(13,61,46,0.7)"/>'
            '<text x="12px" y="17px" font-family="', FONT, '" font-size="12px" fill="#E8E8E8">'
            '<tspan fill="rgba(79,212,164,0.6)">', labelText, '</tspan>',
            valueText,
            '</text></g>'
        ));
    }

    // =========================================================================
    // Corner info: chain (top-right) + expiry (bottom-right)
    // =========================================================================

    function _generateCornerInfo(SVGParams memory params) private pure returns (string memory) {
        return string(abi.encodePacked(
            '<text x="460" y="90" text-anchor="end" fill="rgba(63,182,139,0.4)" font-family="', FONT, '" font-size="10px">',
            params.chain,
            '</text>'
            '<text x="470" y="478" text-anchor="end" fill="rgba(63,182,139,0.5)" font-family="', FONT, '" font-size="10px">',
            params.expiryDisplay,
            '</text>'
        ));
    }

    // =========================================================================
    // Grade badge (top-right) — ecns graded certification
    // =========================================================================

    function _generateGradeBadge(string memory grade, uint8 colorTier) private pure returns (string memory) {
        string memory badgeFill = _gradeBadgeColor(colorTier);
        return string(abi.encodePacked(
            '<g style="transform:translate(390px, 28px)">'
            '<rect width="80px" height="52px" rx="8px" ry="8px" fill="', badgeFill, '"/>'
            '<text x="40" y="34" text-anchor="middle" fill="#E8E8E8" font-family="', FONT,
            '" font-size="22px" font-weight="bold">', grade, '</text>'
            '<text x="40" y="46" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-family="', FONT,
            '" font-size="7px" letter-spacing="1.5">ecns graded</text>'
            '</g>'
        ));
    }

    function _gradeBadgeColor(uint8 tier) private pure returns (string memory) {
        if (tier == 0) return "rgba(94,224,178,0.85)";  // 9.0-10.0 Bright Phosphor
        if (tier == 1) return "rgba(63,182,139,0.70)";  // 7.0-8.5  Primary Green
        if (tier == 2) return "rgba(46,158,118,0.55)";  // 5.0-6.5  Mid Green
        if (tier == 3) return "rgba(26,107,80,0.45)";   // 3.0-4.5  Deep Green
        return "rgba(13,61,46,0.40)";                    // 1.0-2.5  Shadow
    }

    // =========================================================================
    // Rarity sparkle (bottom-right) — for Ultra Rare / Legendary / Epic
    // =========================================================================

    function _rareSparkleSvg() private pure returns (string memory) {
        return
            '<g style="transform:translate(436px, 420px)">'
            '<rect width="36px" height="36px" rx="8px" ry="8px" fill="none" stroke="rgba(63,182,139,0.3)"/>'
            '<g><path style="transform:translate(6px,6px)" d="M12 0L12.6522 9.56587L18 1.6077L13.7819 10.2181L22.3923 6L14.4341 '
            '11.3478L24 12L14.4341 12.6522L22.3923 18L13.7819 13.7819L18 22.3923L12.6522 14.4341L12 24L11.3478 14.4341L6 22.39'
            '23L10.2181 13.7819L1.6077 18L9.56587 12.6522L0 12L9.56587 11.3478L1.6077 6L10.2181 10.2181L6 1.6077L11.3478 9.56587L12 0Z" fill="#4FD4A4"/>'
            '<animateTransform attributeName="transform" type="rotate" from="0 18 18" to="360 18 18" dur="10s" repeatCount="indefinite"/>'
            '</g></g>';
    }

}
