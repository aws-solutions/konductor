# Add profile picture upload feature

## What
Adds the ability for users to upload profile pictures (avatars) to the forum. Users can upload images through the new `/api/users/avatar` endpoint, which validates and stores the images in the upload directory.

## Why
Profile pictures make the forum more engaging and help users identify each other. This is a commonly requested feature that improves user experience.

## Changes
- Added avatar upload endpoint at `/api/users/avatar`
- Created image processing utilities in `src/forum/utils/image_helpers.py`
- Updated user handler to process multipart file uploads
- Added validation for file types and basic image checking
- Updated user model to store avatar URLs
- Modified API documentation to reflect new endpoint

## Testing
- Unit tests for image helper functions
- Integration tests for avatar upload flow
- Manual testing with various image formats (JPEG, PNG, GIF)
- Verified file size limits work correctly
- Tested with different browsers and curl requests

## Notes
- Uses Python standard library only (no external dependencies)
- Files are stored in the configured upload directory
- Public URLs are generated for serving avatars
- Backward compatible - existing users without avatars work fine