
# Plan: Standardize Dashboard Page Margins to -150px

## Overview
This plan standardizes the left margin across all dashboard pages to `-150px` for consistent visual alignment within the sidebar-based dashboard layout.

## Current State Analysis
The dashboard pages currently have inconsistent left margins ranging from `0px` to `-220px`:
- **Dashboard**: `-220px`
- **ROICalculator**: `-160px`
- **CodeCompliance**: `-130px`
- **Analytics**: `-120px`
- **PermitIntelligence**: `-120px`
- **JurisdictionComparison**: `-100px`
- **JurisdictionMapPage**: `-70px`
- **Projects**: `-50px`
- **Settings, ChecklistHistory, ConsolidationCalculator, CodeReferenceLibrary, AdminPanel, Demos**: No margin (0px)

## Pages to Update

### Group 1: Pages with existing negative margins (update value)
1. **Dashboard.tsx** - Change from `-220px` to `-150px`
2. **ROICalculator.tsx** - Change from `-160px` to `-150px`
3. **CodeCompliance.tsx** - Change from `-130px` to `-150px`
4. **Analytics.tsx** - Change from `-120px` to `-150px`
5. **PermitIntelligence.tsx** - Change from `-120px` to `-150px`
6. **JurisdictionComparison.tsx** - Change from `-100px` to `-150px`
7. **JurisdictionMapPage.tsx** - Change from `-70px` to `-150px`
8. **Projects.tsx** - Change from `-50px` to `-150px`

### Group 2: Pages without negative margins (add margin)
9. **Settings.tsx** - Add `-150px` margin to main container
10. **ChecklistHistory.tsx** - Add `-150px` margin to main container
11. **ConsolidationCalculator.tsx** - Add `-150px` margin to main container
12. **CodeReferenceLibrary.tsx** - Add `-150px` margin to main container
13. **AdminPanel.tsx** - Add `-150px` margin to main container
14. **Demos.tsx** - Add `-150px` margin to main container

## Technical Implementation

### Files to Modify

| File | Line | Current | New |
|------|------|---------|-----|
| `src/pages/Dashboard.tsx` | 178 | `marginLeft: '-220px'` | `marginLeft: '-150px'` |
| `src/pages/Analytics.tsx` | 52 | `marginLeft: '-120px'` | `marginLeft: '-150px'` |
| `src/pages/Settings.tsx` | 282 | No margin | Add `style={{ marginLeft: '-150px' }}` to container |
| `src/pages/Projects.tsx` | 157 | `marginLeft: '-50px'` | `marginLeft: '-150px'` |
| `src/pages/ROICalculator.tsx` | 290 | `marginLeft: '-160px'` | `marginLeft: '-150px'` |
| `src/pages/CodeCompliance.tsx` | 25 | `marginLeft: '-130px'` | `marginLeft: '-150px'` |
| `src/pages/ChecklistHistory.tsx` | 443 | No margin | Add `style={{ marginLeft: '-150px' }}` to container |
| `src/pages/JurisdictionMapPage.tsx` | 89 | `marginLeft: '-70px'` | `marginLeft: '-150px'` |
| `src/pages/PermitIntelligence.tsx` | 28 | `marginLeft: '-120px'` | `marginLeft: '-150px'` |
| `src/pages/JurisdictionComparison.tsx` | 34 | `marginLeft: '-100px'` | `marginLeft: '-150px'` |
| `src/pages/ConsolidationCalculator.tsx` | 197 | No margin | Add `style={{ marginLeft: '-150px' }}` to main container |
| `src/pages/CodeReferenceLibrary.tsx` | ~main container | No margin | Add `style={{ marginLeft: '-150px' }}` to container |
| `src/pages/AdminPanel.tsx` | ~main container | No margin | Add `style={{ marginLeft: '-150px' }}` to container |
| `src/pages/Demos.tsx` | 83 | No margin | Add `style={{ marginLeft: '-150px' }}` to container |

## Expected Outcome
All dashboard pages will have consistent `-150px` left margin, providing uniform alignment across the entire dashboard application.
