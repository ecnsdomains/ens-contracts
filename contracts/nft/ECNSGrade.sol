// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

import "@openzeppelin/contracts/utils/Strings.sol";

/// @title ECNSGrade
/// @notice Pure library for computing ECNS name grades on a 1.0–10.0 scale.
///         Four sub-grades (Scarcity, Composition, Resonance, Structure) sum to
///         a raw 0–100 score mapped to half-point increments.
///         All computation is pure arithmetic — zero storage, zero external calls.
library ECNSGrade {
    using Strings for uint256;

    struct SubGrades {
        uint8 scarcity;    // 0-35
        uint8 composition; // 0-25
        uint8 resonance;   // 0-25
        uint8 structure;   // 0-15
    }

    // Character class enum values (matches ECNSMetadataRenderer classification)
    uint8 internal constant CLASS_PURE_ALPHA   = 0;
    uint8 internal constant CLASS_ICONIC_LEET  = 1;
    uint8 internal constant CLASS_DICT_LEET    = 2;
    uint8 internal constant CLASS_NUMERIC      = 3;
    uint8 internal constant CLASS_ALPHANUMERIC = 4;
    uint8 internal constant CLASS_HYPHENATED   = 5;

    // Fluency enum values
    uint8 internal constant FLUENCY_EUPHONIOUS = 0;
    uint8 internal constant FLUENCY_FLUENT     = 1;
    uint8 internal constant FLUENCY_STANDARD   = 2;
    uint8 internal constant FLUENCY_HARSH      = 3;

    // Pattern enum values
    uint8 internal constant PATTERN_PALINDROME  = 0;
    uint8 internal constant PATTERN_SEQUENTIAL  = 1;
    uint8 internal constant PATTERN_REPEATING   = 2;
    uint8 internal constant PATTERN_STANDARD    = 3;

    /// @notice Compute the ECNS grade for a name.
    /// @param effectiveLen Effective length (decoded length for leet, label length otherwise)
    /// @param charClass One of CLASS_* constants
    /// @param isDictWord True if label is a real dictionary word
    /// @param fluency One of FLUENCY_* constants
    /// @param pattern One of PATTERN_* constants
    /// @return whole The integer part of the grade (1-10)
    /// @return halfPoint True if the grade has a .5 (e.g., 7.5)
    /// @return sub The four sub-grade scores
    /// @return raw The raw 0-100 total score
    function computeGrade(
        uint256 effectiveLen,
        uint8 charClass,
        bool isDictWord,
        uint8 fluency,
        uint8 pattern
    ) internal pure returns (uint8 whole, bool halfPoint, SubGrades memory sub, uint8 raw) {
        sub.scarcity = _scarcityScore(effectiveLen);
        sub.composition = _compositionScore(charClass, isDictWord);
        sub.resonance = _resonanceScore(fluency);
        sub.structure = _structureScore(pattern);

        raw = sub.scarcity + sub.composition + sub.resonance + sub.structure;

        (whole, halfPoint) = _rawToGrade(raw);
    }

    /// @notice Convert grade to display string (e.g., "7.5" or "10.0")
    function gradeToString(uint8 whole, bool halfPoint) internal pure returns (string memory) {
        if (halfPoint) {
            return string(abi.encodePacked(uint256(whole).toString(), ".5"));
        }
        return string(abi.encodePacked(uint256(whole).toString(), ".0"));
    }

    /// @notice Returns the color tier index (0-4) for the grade badge background.
    ///         0 = gem mint (9.0-10.0), 4 = shadow (1.0-2.5)
    function gradeColorTier(uint8 whole, bool halfPoint) internal pure returns (uint8) {
        uint8 x2 = whole * 2 + (halfPoint ? 1 : 0); // e.g., 9.5 → 19
        if (x2 >= 18) return 0; // 9.0-10.0 → Bright Phosphor
        if (x2 >= 14) return 1; // 7.0-8.5  → Primary Green
        if (x2 >= 10) return 2; // 5.0-6.5  → Mid Green
        if (x2 >= 6)  return 3; // 3.0-4.5  → Deep Green
        return 4;               // 1.0-2.5  → Shadow
    }

    // =========================================================================
    // Sub-grade scoring
    // =========================================================================

    function _scarcityScore(uint256 len) private pure returns (uint8) {
        if (len <= 1)  return 35;
        if (len == 2)  return 33;
        if (len == 3)  return 30;
        if (len == 4)  return 24;
        if (len == 5)  return 18;
        if (len == 6)  return 15;
        if (len == 7)  return 12;
        if (len == 8)  return 8;
        if (len == 9)  return 6;
        if (len == 10) return 4;
        if (len == 11) return 3;
        return 2;
    }

    function _compositionScore(uint8 charClass, bool isDictWord) private pure returns (uint8) {
        uint8 base;
        if (charClass == CLASS_ICONIC_LEET)  base = 25;
        else if (charClass == CLASS_PURE_ALPHA)   base = 20;
        else if (charClass == CLASS_DICT_LEET)    base = 18;
        else if (charClass == CLASS_NUMERIC)      base = 15;
        else if (charClass == CLASS_ALPHANUMERIC) base = 8;
        else base = 4; // Hyphenated

        if (isDictWord && base < 25) base += 5;
        if (base > 25) base = 25;
        return base;
    }

    function _resonanceScore(uint8 fluency) private pure returns (uint8) {
        if (fluency == FLUENCY_EUPHONIOUS) return 25;
        if (fluency == FLUENCY_FLUENT)     return 18;
        if (fluency == FLUENCY_STANDARD)   return 10;
        return 3; // Harsh
    }

    function _structureScore(uint8 pattern) private pure returns (uint8) {
        if (pattern == PATTERN_PALINDROME)  return 15;
        if (pattern == PATTERN_SEQUENTIAL)  return 12;
        if (pattern == PATTERN_REPEATING)   return 10;
        return 2; // Standard
    }

    // =========================================================================
    // Raw score → grade mapping
    // =========================================================================

    function _rawToGrade(uint8 raw) private pure returns (uint8 whole, bool halfPoint) {
        if (raw >= 88) return (10, false);
        if (raw >= 82) return (9, true);
        if (raw >= 76) return (9, false);
        if (raw >= 70) return (8, true);
        if (raw >= 65) return (8, false);
        if (raw >= 60) return (7, true);
        if (raw >= 55) return (7, false);
        if (raw >= 50) return (6, true);
        if (raw >= 45) return (6, false);
        if (raw >= 40) return (5, true);
        if (raw >= 35) return (5, false);
        if (raw >= 30) return (4, true);
        if (raw >= 25) return (4, false);
        if (raw >= 20) return (3, true);
        if (raw >= 15) return (3, false);
        if (raw >= 10) return (2, true);
        if (raw >= 5)  return (2, false);
        if (raw >= 2)  return (1, true);
        return (1, false);
    }
}
