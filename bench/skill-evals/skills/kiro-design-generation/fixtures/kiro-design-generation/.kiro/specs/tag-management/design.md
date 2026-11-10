# Design Document: tag-management

## Overview
Owns the Tag entity and TagService.

## Architecture
TagService behind the shared API.

## Components and Interfaces
```typescript
interface TagService {
  createTag(input: CreateTagInput): Promise<Tag>;
  listTags(resourceId: string): Promise<Tag[]>;
}
```

## Data Models
```typescript
interface Tag {
  tagId: string;      // PK: TAG#<id>
  resourceId: string; // SK: RESOURCE#<id>
  key: string;
  value: string;
}
```

## Error Handling
Standard.

## Testing Strategy
Unit + integration.
