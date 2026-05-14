# User Stories (Milestone 3 Reality Update)

Last Updated: April 3, 2026

This document reflects current implementation status and ownership after recent merges.

## Status Labels
- To Do: not yet started
- In Progress: actively being worked on or partially implemented
- Completed: done and working in the app

## Team Members
- Michael Fattizzo
- Jacob Rowe
- Logan Pavelschak

## User Story 1: Search Cards Across Pokemon and MTG
As a user, I want to search cards by name and filters so I can find cards quickly.

Story Status: In Progress

| Task | Assigned To | Effort | Status |
|---|---|---|---|
| Build search screen with query input and game toggle (Pokemon/MTG) | Michael Fattizzo | Medium | Completed |
| Implement shared filters (set/code, card number, rarity, language, sorting) | Michael Fattizzo | High | Completed |
| Implement game-specific filters for Pokemon and MTG | Michael Fattizzo | High | Completed |
| Integrate Scrydex API search endpoint and request mapping | Michael Fattizzo | High | Completed |
| Handle loading, error, empty-state, and success UI for search results | Logan Pavelschak | Medium | Completed |
| Add stronger visual owned/not-owned indicator styles in search results | Logan Pavelschak | Medium | To Do |

## User Story 2: Add Cards to Collection with Quantity Tracking
As a user, I want to add cards from search to my collection and track quantity owned.

Story Status: Completed

| Task | Assigned To | Effort | Status |
|---|---|---|---|
| Fetch full card details by card ID before saving | Michael Fattizzo | Medium | Completed |
| Persist card and related details to Room database | Michael Fattizzo | High | Completed |
| Wire add-to-collection action from each search result item | Logan Pavelschak | Medium | Completed |
| Show confirmation/status messages when save succeeds or fails | Logan Pavelschak | Low | Completed |
| Support clear quantity increment workflow in-app (not only first add) | Logan Pavelschak | Medium | Completed |

## User Story 3: View Collection by Game and Open Card Details
As a user, I want to browse cards I own and open a card detail view.

Story Status: Completed

| Task | Assigned To | Effort | Status |
|---|---|---|---|
| Build collection screen with Pokemon/MTG collection selector | Logan Pavelschak | Medium | Completed |
| Display owned cards from local database in a grid of tappable tiles | Logan Pavelschak | Medium | Completed |
| Navigate from collection tile to detailed card preview screen | Logan Pavelschak | Medium | Completed |
| Show card image, metadata, rules text, and owned quantity in preview | Logan Pavelschak | Medium | Completed |

## User Story 4: Manage Binders and Collection Shortcuts
As a user, I want to organize cards into binders and manage those binders.

Story Status: Completed

| Task | Assigned To | Effort | Status |
|---|---|---|---|
| Create and list binders filtered by selected game type | Logan Pavelschak | Medium | Completed |
| Open binder detail view and show cards linked to that binder | Logan Pavelschak | Medium | Completed |
| Rename a binder from binder detail screen | Michael Fattizzo | Low | Completed |
| Delete a binder with confirmation | Michael Fattizzo | Low | Completed |
| Add or remove a card from selected binders from card preview | Michael Fattizzo | Medium | Completed |
| Show recently viewed binder shortcut and counts on Home screen | Logan Pavelschak | Medium | Completed |
| Add quantity controls per card inside binder detail view | Logan Pavelschak | Medium | Completed |

## User Story 5: Keep Data Saved Locally and Updated in Real Time
As a user, I want collection changes to persist automatically without manual save steps.

Story Status: Completed

| Task | Assigned To | Effort | Status |
|---|---|---|---|
| Configure Room database and DAOs for cards, collection entries, binders, and decks | Michael Fattizzo | High | Completed |
| Hook repositories and app container for dependency wiring | Michael Fattizzo | Medium | Completed |
| Use observable flows so collection, binder, and deck UI updates automatically | Michael Fattizzo | Medium | Completed |
| Ensure card removal updates quantity and deletes related data when quantity reaches zero | Michael Fattizzo | Medium | Completed |

## User Story 6: Core Navigation and App Structure
As a user, I want consistent app navigation so I can move between major screens.

Story Status: Completed

| Task | Assigned To | Effort | Status |
|---|---|---|---|
| Implement bottom navigation for Home, Search, Collection, Decks, and Scan | Jacob Rowe | Medium | Completed |
| Set up initial screen scaffolding for Home/Search/Collection/Decks/Scan | Jacob Rowe | Medium | Completed |
| Add route structure that enabled binder details and card preview navigation | Jacob Rowe | Medium | Completed |

## User Story 7: Scan Workflow
As a user, I want to scan physical cards to add them quickly.

Story Status: Complete

| Task | Assigned To | Effort | Status |
|---|---|---|---|
| Build camera permission flow and camera preview integration | Jacob Rowe | High | Completed |
| Add barcode/card-recognition pipeline and parse scan output | Michael Fattizzo | High | Complete |
| Connect scan results to add-to-collection flow with retry/error handling | Michael Fattizzo | Medium | Complete |
| Replace placeholder Scan screen with production implementation | Logan Pavelschak | Medium | Completed |

## User Story 8: Deck Management
As a user, I want to build and manage decks separately from binders.

Story Status: Complete (one task deferred)

| Task | Assigned To | Effort | Status |
|---|---|---|---|
| Define deck data model, storage schema, and repository methods | Logan Pavelschak | High | Completed |
| Replace placeholder Decks screen with create/delete deck workflows | Logan Pavelschak | High | Completed |
| Add card add/remove and quantity controls for deck contents | Logan Pavelschak | High | Completed |
| Add deck sorting, game filter, and empty-state handling | Logan Pavelschak | Medium | Completed |
| Add deck rename/edit flow | Logan Pavelschak | Medium | Completed |
| Expand gameplay-rule validation testing | Logan Pavelschak | Medium | Deferred |
| Show recently viewed deck shortcut and breakdown on Home screen | Logan Pavelschak | Medium | Completed |

We decided to defer the deck rule validation to post-beta because of time constraints, and adding the core deck management features and UI polish was a higher priority for the overall user experience. 

## User Story 9: Settings and Preferences
As a user, I want to manage app preferences like theme and language.

Story Status: In Progress (Deferred some tasks)

| Task | Assigned To | Effort | Status |
|---|---|---|---|
| Design settings screen layout and navigation entry point | Logan Pavelschak | Medium | Completed |
| Implement language preference UI and app-wide updates | Logan Pavelschak | Medium | To Do (Deferred) |
| Implement theme preference UI and app-wide updates | Logan Pavelschak | Medium | In Progress |
| Persist preference values across app restarts | Michael Fattizzo | Medium | To Do (Deferred) |

We decided to defer the language switching implementation to post-beta to focus on core collection management features and polish for the presentation. It was also not a requirement and after re-analyzing, we decided it just wasn't worth the time investment for the presentation when we had so many other features to complete and polish.

## User Story 10: Import/Export Collection Data
As a user, I want to export and import local collection data for backup and sharing.

Story Status: To Do (Deferred)

| Task | Assigned To | Effort | Status |
|---|---|---|---|
| Finalize import/export format and validation rules | Michael Fattizzo | High | To Do |
| Implement export flow for collection and selected binders | Logan Pavelschak | Medium | To Do |
| Implement import flow, deduplication strategy, and result summary UI | Michael Fattizzo | High | To Do |
| Build file picker and user feedback/error flows | Logan Pavelschak | Medium | To Do |

We completely deferred this user story to post-beta because of time constraints and the fact that it was a "what if" feature that was not required for the presentation. 

## Milestone Timeline

### Milestone 2 (Planning + Initial Scaffold)
Focus: Core structure and baseline screens

Tasks:
- MS2-US6T1: Implement bottom navigation and base route setup [Completed]
- MS2-US6T2: Scaffold Home/Search/Collection/Decks/Scan screens [Completed]
- MS2-US5T1: Set up initial local database entities/DAOs [Completed]
- MS2-US1T1: Define search UX direction and initial query flow [Completed]
- MS2-US4T1: Outline binder/subcollection workflow [Completed]

### Milestone 3 (Core Features and Data Integration)
Focus: Working core features and data-backed workflows

Tasks:
- MS3-US1T1: Integrate Scrydex search and game-specific filtering [Completed]
- MS3-US2T1: Save selected search result cards into local DB [Completed]
- MS3-US2T2: Connect add-to-collection action from results [Completed]
- MS3-US2T3: Support reliable in-app quantity increment workflow [In Progress]
- MS3-US3T1: Implement collection screen with owned-card grid + card preview navigation [Completed]
- MS3-US4T1: Implement create/list/rename/delete binder workflows [Completed]
- MS3-US4T2: Implement add/remove card-to-binder linking [Completed]
- MS3-US8T1: Implement deck repository, DAO, and deck rules scaffolding [Completed]
- MS3-US8T2: Implement deck create/delete and card add/remove flows [Completed]
- MS3-US8T3: Implement deck sorting and deck validation indicators [Completed]
- MS3-US8T4: Add deck rename/edit flow polish and deeper rules testing based on individual card games [In Progress]
- MS3-US7T1: Replace placeholder scan implementation [In Progress]


### Milestone 4 (Current Milestone)
Focus: Feature completion, polish, and deferred features

Tasks:
- MS4-US1T1: Add stronger visual owned/not-owned indicator styles in search results [To Do]
- MS4-US7T1: Complete camera permissions, scan capture, and recognition pipeline [To Do]
- MS4-US7T2: Connect scan output to collection with robust error handling [To Do]
- MS4-US8T1: Finish remaining deck edit/polish tasks and validation test pass (including deferred gameplay-rule validation) [In Progress]
- MS4-US9T1: Implement settings screen, theme/language switching, and persistence (language switching and persistence deferred) [In Progress]
- MS4-US10T1: Implement import/export with validation and user feedback [To Do]
- MS4-USH1: Improve home screen functionality beyond placeholder content [Completed]

Summary of status:
- Most core features (search, collection, binders, decks, navigation, scan preview, home dashboard) are implemented and stable.
- Remaining work focuses on: scan workflow completion, deck validation polish, settings (theme/language), import/export, and UI polish for search and home screens.
- Some features (language switching, import/export) are deferred or partially implemented due to time constraints.

## TLDR
- Currently implemented: Search, API integration, local persistence, collection browsing, binder management, card preview, deck management, dynamic home dashboard with stats, and initial camera scanning preview.

- What remains: Card scanning, home page view, more detailed deck validation, settings/preferences implementation, theme/language switching, import/export, and various UI polish and edge case handling across features.
