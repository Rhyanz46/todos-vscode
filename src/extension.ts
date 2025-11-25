// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

interface ApiTodo {
    id: string;
    title: string;
    status: 'pending' | 'done';
    score_plus?: number;
    score_minus?: number;
}

interface ApiProfile {
    id: string;
    username?: string;
    email?: string;
    timezone?: string;
}

type TodoStatusVisual = {
    icon: string;
    label: string;
    status: 'pending' | 'done';
};

function resolveStatus(rawStatus?: string): TodoStatusVisual {
    const statusText = (rawStatus ?? '').trim();
    const normalized = statusText.toLowerCase();

    if (normalized === 'done' || normalized === 'completed' || normalized === 'finished') {
        return { icon: '✅', label: statusText || 'done', status: 'done' };
    }

    if (normalized.includes('progress') || normalized === 'in progress' || normalized === 'started') {
        return { icon: '🔄', label: statusText || 'in progress', status: 'pending' };
    }

    return { icon: '⏳', label: statusText || 'not started', status: 'pending' };
}

class AuthManager {
    private readonly secretKey = 'codextodo.token';

    constructor(private readonly secretStorage: vscode.SecretStorage, private readonly apiBaseUrl: string) {}

    async ensureContext(): Promise<void> {
        const existing = await this.secretStorage.get(this.secretKey);
        await this.setContext(Boolean(existing));
    }

    async getToken(options?: { promptIfMissing?: boolean }): Promise<string | undefined> {
        const existing = await this.secretStorage.get(this.secretKey);
        if (existing) {
            await this.setContext(true);
            return existing;
        }
        if (options?.promptIfMissing === false) {
            await this.setContext(false);
            return undefined;
        }
        return this.promptForToken();
    }

    async promptForToken(): Promise<string | undefined> {
        if (!this.apiBaseUrl) {
            vscode.window.showWarningMessage('codextodo.apiBaseUrl is not set');
            return undefined;
        }

        const token = await vscode.window.showInputBox({
            title: 'Enter Backend Token',
            prompt: 'Paste the API token for the Todo backend',
            password: true,
            ignoreFocusOut: true,
        });

        const trimmed = token?.trim();
        if (!trimmed) {
            vscode.window.showWarningMessage('Token not provided');
            return undefined;
        }

        const profile = await this.validateToken(trimmed);
        if (!profile) {
            await this.clearToken();
            return undefined;
        }

        await this.secretStorage.store(this.secretKey, trimmed);
        await this.setContext(true);
        const userLabel = profile.username || profile.email || profile.id;
        vscode.window.showInformationMessage(`Welcome ${userLabel}`);
        return trimmed;
    }

    async clearToken(): Promise<void> {
        await this.secretStorage.delete(this.secretKey);
        await this.setContext(false);
    }

    private async setContext(hasToken: boolean): Promise<void> {
        await vscode.commands.executeCommand('setContext', 'codextodo.hasToken', hasToken);
    }

    private async validateToken(token: string): Promise<ApiProfile | undefined> {
        const sanitizedBaseUrl = this.apiBaseUrl.replace(/\/$/, '');
        const url = `${sanitizedBaseUrl}/api/profile`;

        try {
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }

            const data = (await response.json()) as Partial<ApiProfile>;
            if (!data?.id) {
                throw new Error('Profile response missing id');
            }

            return {
                id: String(data.id),
                username: data.username ? String(data.username) : undefined,
                email: data.email ? String(data.email) : undefined,
                timezone: data.timezone ? String(data.timezone) : undefined,
            };
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Token validation failed: ${reason}`);
            return undefined;
        }
    }
}

class TodoItem extends vscode.TreeItem {
    constructor(public readonly todo: ApiTodo, displayStatus?: string) {
        super(todo.title, vscode.TreeItemCollapsibleState.None);

        const scorePlus = todo.score_plus ?? 0;
        const scoreMinus = todo.score_minus ?? 0;
        const { icon, label } = resolveStatus(displayStatus || todo.status);
        const statusLabel = `${icon} ${label}`;
        this.description = `${statusLabel} (+${scorePlus} / -${scoreMinus})`;
        this.contextValue = 'todoItem';
        this.command = {
            command: 'codextodo.openTodo',
            title: 'Open Todo',
            arguments: [todo, label],
        };
    }
}

class TodoTreeDataProvider implements vscode.TreeDataProvider<TodoItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TodoItem | undefined | void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private items: TodoItem[] = [];

    constructor(private readonly apiBaseUrl: string, private readonly authManager: AuthManager) {}

    async refresh(options?: { allowPrompt?: boolean }): Promise<void> {
        await this.loadFromBackend(options?.allowPrompt !== false);
        this.onDidChangeTreeDataEmitter.fire();
    }

    getTreeItem(element: TodoItem): vscode.TreeItem {
        return element;
    }

    getChildren(_element?: TodoItem): Promise<TodoItem[]> {
        return Promise.resolve(this.items);
    }

    private async loadFromBackend(allowPromptForToken: boolean): Promise<void> {
        if (!this.apiBaseUrl) {
            vscode.window.showWarningMessage('codextodo.apiBaseUrl is not set');
            this.items = [];
            return;
        }

        const sanitizedBaseUrl = this.apiBaseUrl.replace(/\/$/, '');
        const today = new Date();
        const yyyyMmDd = today.toISOString().slice(0, 10);
        const url = `${sanitizedBaseUrl}/api/tracks?date=${yyyyMmDd}`;

        const token = await this.authManager.getToken({ promptIfMissing: allowPromptForToken });
        if (!token) {
            this.items = [];
            return;
        }

        try {
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            if (!Array.isArray(data)) {
                throw new Error('Unexpected response format');
            }

            this.items = data.map((raw) => {
                const rawStatus = typeof raw?.status === 'string' ? String(raw.status) : '';
                const { status: normalizedStatus } = resolveStatus(rawStatus);

                const todo: ApiTodo = {
                    id: String(raw?.id ?? ''),
                    title: String(raw?.title ?? raw?.name ?? 'Untitled'),
                    status: normalizedStatus,
                    score_plus: typeof raw?.score_plus === 'number' ? raw.score_plus : undefined,
                    score_minus: typeof raw?.score_minus === 'number' ? raw.score_minus : undefined,
                };

                const start = raw?.start ? new Date(raw.start) : undefined;
                const end = raw?.end ? new Date(raw.end) : undefined;
                const range = start && end
                    ? `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : undefined;

                const item = new TodoItem(todo, rawStatus || undefined);
                if (range) {
                    item.description = `${item.description} | ${range}`;
                }

                return item;
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load todos: ${reason}`);
            this.items = [];
        }
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const apiBaseUrl = vscode.workspace.getConfiguration('codextodo').get<string>('apiBaseUrl') ?? '';
    const authManager = new AuthManager(context.secrets, apiBaseUrl);
    void authManager.ensureContext();
    const provider = new TodoTreeDataProvider(apiBaseUrl, authManager);

    void provider.refresh();

    const view = vscode.window.createTreeView('planEngineeringView', {
        treeDataProvider: provider,
    });

    const refreshCommand = vscode.commands.registerCommand('codextodo.refresh', async () => {
        await provider.refresh();
    });

    const loginCommand = vscode.commands.registerCommand('plan-engineering.login', async () => {
        await authManager.clearToken();
        await authManager.promptForToken();
        await provider.refresh();
    });

    const logoutCommand = vscode.commands.registerCommand('plan-engineering.logout', async () => {
        await authManager.clearToken();
        vscode.window.showInformationMessage('Logged out from backend');
        await provider.refresh({ allowPrompt: false });
    });

    const openTodoCommand = vscode.commands.registerCommand('codextodo.openTodo', (todo: ApiTodo, displayStatus?: string) => {
        if (!todo) {
            return;
        }

        const scorePlus = todo.score_plus ?? 0;
        const scoreMinus = todo.score_minus ?? 0;
        const statusText = displayStatus || todo.status;
        vscode.window.showInformationMessage(`Todo: ${todo.title} (${statusText}) [+${scorePlus} / -${scoreMinus}]`);
    });

    context.subscriptions.push(view, refreshCommand, loginCommand, logoutCommand, openTodoCommand);
}

export function deactivate(): void {}
