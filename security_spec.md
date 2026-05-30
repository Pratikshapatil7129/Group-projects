# Security Specifications & Rules Compliance

This document outlines the data invariants, threat payloads, and access rules for the Collaborative Project Board.

## Part 1: Data Invariants

1. **Relation Security**: A user can only access a Project, its Columns, its Tasks, and its Comments if they are listed as a document in the `/projects/{projectId}/members/{userId}` subcollection.
2. **Identity Verification**: No user can write a document with an `authorId` or `ownerId` different from their own authenticated Firebase UID.
3. **Immutability Protection**: Fields such as `createdAt`, `projectId`, `ownerId`, and `taskId` once set must be immutable across all update operations.
4. **Notification Sandboxing**: Users can only read and update ("mark as read") their own notifications under `/users/{userId}/notifications/{notificationId}`. Other users can ONLY create notifications in a user's notification list if they are members of the same project.
5. **Verified Users**: All database writes are guarded by `request.auth.token.email_verified == true` to prevent unverified domain email spoofing.

---

## Part 2: The "Dirty Dozen" Threat Payloads

The rules are designed to prevent the following 12 bypass payloads from succeeding, returning `PERMISSION_DENIED`:

### Group A: Identity Spoofing & Privilege Escalation

1. **Payload 1 (Profile Impersonation)**: Logged in user `attacker_123` attempts to update `/users/victim_456` setting `displayName` to "Imposter Victim".
2. **Payload 2 (Self-Promoted Owner)**: A non-owner guest user attempts to set `/projects/project_abc/members/attacker_123` role to `owner`.
3. **Payload 3 (Spoofed Creator)**: Attacker attempts to create `/projects/stolen_proj` with `ownerId: "victim_uid"`.
4. **Payload 4 (Fake Comment Author)**: Attacker tries to write a comment at `/projects/p/tasks/t/comments/c` setting `authorId: "victim_uid"`.

### Group B: Relational Leakage (Bypassing Membership)

5. **Payload 5 (Unauthenticated Write)**: Non-logged-in user attempts to create a project `/projects/p1`.
6. **Payload 6 (No-Member Task Creation)**: Logged in user who is NOT a member of `project_sec` attempts to add a task to `/projects/project_sec/tasks/task_leak`.
7. **Payload 7 (Silent Comment Insertion)**: Non-member attempts to post a comment in `/projects/p1/tasks/t1/comments/com1`.
8. **Payload 8 (Foreign Notification Injection)**: User `attacker_1` tries to post a spam notification `/users/victim_2/notifications/nt_1` for a project `attacker_1` does NOT belong to.

### Group C: State Shortcut & Integrity Breaches

9. **Payload 9 (Ghost Fields / Value Poisoning)**: User updates task with extra unauthorized field `admin_bypass: true` or a 10MB description.
10. **Payload 10 (Immutability Violation)**: User attempts to change `projectId` of an existing task on update.
11. **Payload 11 (Client-Sourced Timestamps)**: User attempts to create a comment with `createdAt` set to a future date instead of `request.time`.
12. **Payload 12 (Foreign Notification Read)**: User attempts to read `/users/victim_uid/notifications/notif_abc`.

---

## Part 3: Access Rules Map & Logic Structure

* Full Fortress rules reside in `/firestore.rules`.
* Helper functions `isValidId()`, `isSignedIn()`, and membership gates are checked synchronously.
