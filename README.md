# Plan Enginering Todo View

A VS Code Activity Bar view that lists todos from your backend API.

## Configure
- Default `codextodo.apiBaseUrl` is `https://go-routine.com/core`. You can override it in VS Code settings. The extension loads todos from `${apiBaseUrl}/todos`.

## Run and develop
- Install deps: `npm install`
- Start watcher: `npm run watch`
- Launch the extension: press `F5` (uses the "Run Extension" config)

## Commands
- `codextodo.refresh` refreshes the list from the backend.
- `codextodo.openTodo` shows the selected todo details.
