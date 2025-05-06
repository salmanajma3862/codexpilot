# Change Log

All notable changes to the "codexpilot" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.1] - 2025-05-06

### Added
- Automatic context tracking: The currently active file editor is now automatically added to the chat context if not already present.
- Auto-context toggle: Added an "eye" icon button to the auto-context pill in the chat UI, allowing users to temporarily exclude the current file from the context sent to the AI. The state resets when switching to a new file.

### Changed
- Context Management: Reworked internal state to differentiate between the single auto-tracked file and multiple manually added files (cumulative context).
- Context UI: The auto-tracked file pill is now visually distinct (marked "Current") and its remove button is replaced by the eye toggle. Manually added pills retain the remove button.

## [0.1.0]

- Initial release