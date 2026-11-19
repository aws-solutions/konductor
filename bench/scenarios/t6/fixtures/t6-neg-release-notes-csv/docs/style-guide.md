# Mobile Banking App - Documentation Style Guide

## Release Notes Format

### Version Headers
- Use format: `## Version X.Y.Z - YYYY-MM-DD`
- For informal dates, use month abbreviation and day (e.g., "Jan 28, 2024")
- Major releases (X.0.0) should have detailed migration notes if applicable

### Change Categories
1. **New Features**: Brand new functionality added to the app
2. **Improvements**: Enhancements to existing features
3. **Bug Fixes**: Corrections to reported issues
4. **Security Updates**: Security-related patches and updates
5. **Documentation**: Updates to user guides, help text, or internal docs

### Bullet Point Format
- Start with past tense verb (Fixed, Added, Improved, etc.)
- Be specific but concise (1-2 sentences max)
- Include technical details only when relevant to users
- Use plain language, avoid jargon when possible

### Special Cases
- For multi-line descriptions, continue on next line with 2-space indent
- When mentioning specific platforms (iOS, Android), specify which version if relevant
- For dates in text, use full format: "January 28, 2024" or ISO format: "2024-01-28"

### Writing Guidelines
- **Tone**: Professional but approachable
- **Audience**: Mix of technical and non-technical users
- **Length**: Keep release notes to 1-2 pages max
- **Accessibility**: Use clear headings, bullet points for scannability

## Content Standards

### Version Numbering
- Follow semantic versioning: MAJOR.MINOR.PATCH
- Major (X): Breaking changes, major new features
- Minor (Y): New features, backwards compatible
- Patch (Z): Bug fixes, security patches

### Date Formats
- In headers: Prefer YYYY-MM-DD (ISO format)
- In text: Can use "Month DD, YYYY" or "MM/DD/YYYY"
- Consistency within a document is more important than specific format

### Technical Details
- Include platform-specific notes when relevant
- Mention database or API version changes if they affect users
- Note deprecations with clear migration paths

### Quality Checklist
- [ ] All bullet points are complete sentences
- [ ] No markdown formatting errors
- [ ] Dates are consistent within document
- [ ] Categories are used correctly
- [ ] No internal jargon without explanation

---

*Approved by: Documentation Committee, 2024-01-15*