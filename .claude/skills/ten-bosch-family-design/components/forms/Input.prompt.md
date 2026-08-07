Labeled text input for forms; 44px tall to meet touch-target minimums.

```jsx
<Input label="Event name" placeholder="Family dinner" />
<Input label="Time" error="Pick a time" />
```

Pass `icon` for a leading icon, `helpText` for quiet supporting copy, `error` to switch the border/help text to `--color-danger` (error message replaces helpText when both are set).
