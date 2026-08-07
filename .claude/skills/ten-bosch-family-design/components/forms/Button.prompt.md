Primary call-to-action control; use `variant="primary"` for the one main action on a screen, `outline`/`ghost` for secondary actions, `danger` for destructive ones.

```jsx
<Button variant="primary" size="md">Add to calendar</Button>
<Button variant="outline">Cancel</Button>
```

Variants: `primary`, `secondary`, `outline`, `ghost`, `danger`. Sizes: `sm` (34px), `md` (44px, default — meets the 44px touch target), `lg` (52px). Pass `icon` for a leading icon element. `disabled` dims to 50% opacity and blocks pointer events via `cursor:not-allowed`.
