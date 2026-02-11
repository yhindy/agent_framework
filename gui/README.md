# Minion Orchestrator GUI

See the main [README.md](../README.md) for full documentation, including GUI features, keyboard shortcuts, project structure, and troubleshooting.

## Development

```bash
cd gui
npm install
npm run dev
```

## Building

```bash
npm run build
```

## Testing

```bash
npm test                    # Unit tests
npm run test:e2e            # E2E tests
npm run test:e2e:headed     # E2E with visible browser
```

See [TESTING.md](TESTING.md) for comprehensive test scenarios.

## Troubleshooting

### "Cannot find module pty.node" error

Rebuild native modules for Electron:

```bash
npm run rebuild
npm run dev
```

### Clean reinstall

```bash
rm -rf node_modules package-lock.json
npm install
npm run rebuild
npm run dev
```

For more troubleshooting, see [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).
