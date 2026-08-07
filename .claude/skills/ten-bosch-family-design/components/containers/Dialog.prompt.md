Centered modal with a scrim; clicking the scrim calls `onClose`. Pass `actions` as a row of `<Button>`s.

```jsx
<Dialog open={true} title="Delete this event?" onClose={close}
  actions={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger">Delete</Button></>}>
  This can't be undone.
</Dialog>
```
