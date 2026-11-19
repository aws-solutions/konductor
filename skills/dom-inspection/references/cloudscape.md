# Cloudscape

Read this when the page under inspection uses Cloudscape components (`awsui` class names).

## Cloudscape-Specific Notes

Cloudscape components wrap native HTML inputs, so the validation attributes are on the inner `<input>` element, not the Cloudscape component wrapper. Always query the inner input:

```javascript
// Correct: query inner input inside Cloudscape wrapper
document.querySelectorAll('[class*="awsui"] input, [class*="awsui"] select, [class*="awsui"] textarea');
// Not: document.querySelectorAll('awsui-input')
```

Error messages in Cloudscape render in `[class*="error-text"]` or `[data-testid*="error"]` elements adjacent to the field wrapper, not via `aria-describedby` on the input itself.
