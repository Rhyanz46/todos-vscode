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
    timezoneOffset?: string;
}

interface AuthState {
    token: string;
    profile?: ApiProfile;
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

function parseOffsetMinutes(offset?: string): number | undefined {
    if (!offset) {
        return undefined;
    }
    const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim());
    if (!match) {
        return undefined;
    }
    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
        return undefined;
    }
    return sign * (hours * 60 + minutes);
}

function dateStringWithOffset(offset?: string): string {
    const now = new Date();
    const offsetMinutes = parseOffsetMinutes(offset) ?? -now.getTimezoneOffset();
    const localForOffset = new Date(now.getTime() + offsetMinutes * 60_000);
    return localForOffset.toISOString().slice(0, 10);
}

function formatDateTimeWithOffset(date: Date, offset?: string): string {
    const offsetMinutes = parseOffsetMinutes(offset) ?? -date.getTimezoneOffset();
    const adjusted = new Date(date.getTime() + offsetMinutes * 60_000);
    const iso = adjusted.toISOString().replace('Z', '');

    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absMinutes = Math.abs(offsetMinutes);
    const hours = Math.floor(absMinutes / 60)
        .toString()
        .padStart(2, '0');
    const minutes = Math.floor(absMinutes % 60)
        .toString()
        .padStart(2, '0');
    const finalOffset = `${sign}${hours}:${minutes}`;

    return `${iso}${finalOffset}`;
}

class AuthManager {
    private readonly secretKey = 'engineer-plan.auth';

    constructor(private readonly secretStorage: vscode.SecretStorage, private readonly apiBaseUrl: string) {}

    async ensureContext(): Promise<void> {
        const existing = await this.readAuth();
        await this.setContext(Boolean(existing?.token));
    }

    async getToken(options?: { promptIfMissing?: boolean }): Promise<string | undefined> {
        const existing = await this.readAuth();
        if (existing?.token) {
            await this.setContext(true);
            return existing.token;
        }
        if (options?.promptIfMissing === false) {
            await this.setContext(false);
            return undefined;
        }
        return this.promptForToken();
    }

    async promptForToken(): Promise<string | undefined> {
        if (!this.apiBaseUrl) {
            vscode.window.showWarningMessage('engineer-plan.apiBaseUrl is not set');
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

        await this.secretStorage.store(this.secretKey, JSON.stringify({ token: trimmed, profile } satisfies AuthState));
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
        await vscode.commands.executeCommand('setContext', 'engineerPlan.hasToken', hasToken);
    }

    async getAuthState(): Promise<AuthState | undefined> {
        return this.readAuth();
    }

    private async readAuth(): Promise<AuthState | undefined> {
        const raw = await this.secretStorage.get(this.secretKey);
        if (!raw) {
            return undefined;
        }
        try {
            const parsed = JSON.parse(raw) as AuthState;
            if (parsed?.token) {
                return parsed;
            }
        } catch {
            return undefined;
        }
        return undefined;
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

            const timezoneOffset = this.extractOffset(data.timezone);

            return {
                id: String(data.id),
                username: data.username ? String(data.username) : undefined,
                email: data.email ? String(data.email) : undefined,
                timezone: data.timezone ? String(data.timezone) : undefined,
                timezoneOffset,
            };
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Token validation failed: ${reason}`);
            return undefined;
        }
    }

    private extractOffset(tz?: string): string | undefined {
        if (!tz) {
            return undefined;
        }
        try {
            const now = new Date();
            const locale = now.toLocaleString('en-US', { timeZone: tz });
            const parsed = new Date(locale);
            const offsetMinutes = (parsed.getTime() - now.getTime()) / (1000 * 60);
            if (Number.isNaN(offsetMinutes)) {
                return undefined;
            }
            const sign = offsetMinutes >= 0 ? '+' : '-';
            const absMinutes = Math.abs(offsetMinutes);
            const hours = Math.floor(absMinutes / 60)
                .toString()
                .padStart(2, '0');
            const minutes = Math.floor(absMinutes % 60)
                .toString()
                .padStart(2, '0');
            return `${sign}${hours}:${minutes}`;
        } catch {
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
            command: 'engineer-plan.openTodo',
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
            vscode.window.showWarningMessage('engineer-plan.apiBaseUrl is not set');
            this.items = [];
            return;
        }

        const authState = await this.authManager.getAuthState();
        const sanitizedBaseUrl = this.apiBaseUrl.replace(/\/$/, '');
        const yyyyMmDd = dateStringWithOffset(authState?.profile?.timezoneOffset);
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
    const apiBaseUrl = vscode.workspace.getConfiguration('engineer-plan').get<string>('apiBaseUrl') ?? '';
    const authManager = new AuthManager(context.secrets, apiBaseUrl);
    void authManager.ensureContext();
    const provider = new TodoTreeDataProvider(apiBaseUrl, authManager);

    void provider.refresh();

    const view = vscode.window.createTreeView('engineerPlanView', {
        treeDataProvider: provider,
    });

    const refreshCommand = vscode.commands.registerCommand('engineer-plan.refresh', async () => {
        await provider.refresh();
    });

    const loginCommand = vscode.commands.registerCommand('engineer-plan.login', async () => {
        await authManager.clearToken();
        await authManager.promptForToken();
        await provider.refresh();
    });

    const logoutCommand = vscode.commands.registerCommand('engineer-plan.logout', async () => {
        await authManager.clearToken();
        vscode.window.showInformationMessage('Logged out from backend');
        await provider.refresh({ allowPrompt: false });
    });

    const createCommand = vscode.commands.registerCommand('engineer-plan.create', async () => {
        const auth = await authManager.getAuthState();

        const now = new Date();
        const end = new Date(now.getTime() + 60 * 60 * 1000);
        const offset = auth?.profile?.timezoneOffset;

        const name = await vscode.window.showInputBox({
            title: 'New Todo Title',
            prompt: 'Enter task title',
            ignoreFocusOut: true,
        });
        if (!name) {
            return;
        }

        const start = await vscode.window.showInputBox({
            title: 'Start (ISO with offset)',
            value: formatDateTimeWithOffset(now, offset),
            prompt: 'Example: 2025-11-26T08:11:00+08:00',
            ignoreFocusOut: true,
        });
        if (!start) {
            return;
        }

        const endInput = await vscode.window.showInputBox({
            title: 'End (ISO with offset)',
            value: formatDateTimeWithOffset(end, offset),
            prompt: 'Example: 2025-11-26T09:11:00+08:00',
            ignoreFocusOut: true,
        });
        if (!endInput) {
            return;
        }

        const token = await authManager.getToken();
        if (!token) {
            return;
        }

        const sanitizedBaseUrl = apiBaseUrl.replace(/\/$/, '');
        const url = `${sanitizedBaseUrl}/api/tracks`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    name,
                    start,
                    end: endInput,
                    status: 'not started',
                }),
            });

            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }

            vscode.window.showInformationMessage('Todo created');
            await provider.refresh();
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to create todo: ${reason}`);
        }
    });

    const openTodoCommand = vscode.commands.registerCommand('engineer-plan.openTodo', (todo: ApiTodo, displayStatus?: string) => {
        if (!todo) {
            return;
        }

        const scorePlus = todo.score_plus ?? 0;
        const scoreMinus = todo.score_minus ?? 0;
        const statusText = displayStatus || todo.status;
        vscode.window.showInformationMessage(`Todo: ${todo.title} (${statusText}) [+${scorePlus} / -${scoreMinus}]`);
    });

    context.subscriptions.push(view, refreshCommand, loginCommand, logoutCommand, createCommand, openTodoCommand);
}

export function deactivate(): void {}
