// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

interface ApiTodo {
    id: string;
    title: string;
    status: 'pending' | 'done';
    start?: string;
    end?: string;
    rawStatus?: string;
    tags?: ApiTag[];
}

interface ApiTag {
    id: string | number;
    name: string;
    color?: string;
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
        const { icon } = resolveStatus(displayStatus || todo.status);
        const tagNames = todo.tags?.map((t) => t.name).filter(Boolean).join(', ');
        super(`${icon} - ${todo.title}`, vscode.TreeItemCollapsibleState.None);

        this.description = tagNames ? `${tagNames}` : '';
        this.contextValue = 'todoItem';
        this.command = {
            command: 'engineer-plan.showTodo',
            title: 'Show Todo',
            arguments: [todo],
        };
    }
}

function formatTimeRange(start?: string, end?: string): string | undefined {
    if (!start || !end) {
        return undefined;
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return undefined;
    }
    const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
    return `${startDate.toLocaleTimeString([], opts)}-${endDate.toLocaleTimeString([], opts)}`;
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

    getItems(): TodoItem[] {
        return [...this.items];
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
                    start: raw?.start ? String(raw.start) : undefined,
                    end: raw?.end ? String(raw.end) : undefined,
                    rawStatus: rawStatus || undefined,
                    tags: Array.isArray(raw?.tags)
                        ? raw.tags
                              .map((t: any) => ({
                                  id: t?.id ?? '',
                                  name: String(t?.name ?? ''),
                                  color: typeof t?.color === 'string' ? t.color : undefined,
                              }))
                              .filter((t: ApiTag) => t.name)
                        : undefined,
                };

                const start = raw?.start ? new Date(raw.start) : undefined;
                const end = raw?.end ? new Date(raw.end) : undefined;
                const range = start && end
                    ? `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`
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
    const output = vscode.window.createOutputChannel('Engineer Plan');
    const log = (message: string) => {
        const timestamp = new Date().toISOString();
        output.appendLine(`[${timestamp}] ${message}`);
    };

    const apiBaseUrl = vscode.workspace.getConfiguration('engineer-plan').get<string>('apiBaseUrl') ?? '';
    const authManager = new AuthManager(context.secrets, apiBaseUrl);
    void authManager.ensureContext();
    const provider = new TodoTreeDataProvider(apiBaseUrl, authManager);

    void provider.refresh();

    const view = vscode.window.createTreeView('engineerPlanView', {
        treeDataProvider: provider,
    });

    const autoRefreshHandle = setInterval(() => {
        void provider.refresh({ allowPrompt: false });
    }, 15 * 60 * 1000);

    const refreshCommand = vscode.commands.registerCommand('engineer-plan.refresh', async () => {
        log('Refresh requested');
        await provider.refresh();
    });

    const openWebsiteCommand = vscode.commands.registerCommand('engineer-plan.openWebsite', async () => {
        await vscode.env.openExternal(vscode.Uri.parse('https://go-routine.com/'));
    });

    const loginCommand = vscode.commands.registerCommand('engineer-plan.login', async () => {
        await authManager.clearToken();
        await authManager.promptForToken();
        await provider.refresh();
    });

    const logoutCommand = vscode.commands.registerCommand('engineer-plan.logout', async () => {
        await authManager.clearToken();
        log('Logged out');
        vscode.window.showInformationMessage('Logged out from backend');
        await provider.refresh({ allowPrompt: false });
    });

    const createCommand = vscode.commands.registerCommand('engineer-plan.create', async () => {
        log('Create todo requested');
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
            log(`POST ${url}`);
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

            log(`Created todo, status ${response.status}`);
            vscode.window.showInformationMessage('Todo created');
            await provider.refresh();
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            log(`Create failed: ${reason}`);
            vscode.window.showErrorMessage(`Failed to create todo: ${reason}`);
        }
    });

    const deleteTodoCommand = vscode.commands.registerCommand('engineer-plan.deleteTodo', async (todo: TodoItem | ApiTodo) => {
        const target = todo instanceof TodoItem ? todo.todo : todo;
        if (!target?.id) {
            log('Delete requested without todo id');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Delete todo: ${target.title}?`,
            { modal: true },
            'Delete'
        );
        if (confirm !== 'Delete') {
            return;
        }

        const token = await authManager.getToken();
        if (!token) {
            return;
        }

        const sanitizedBaseUrl = apiBaseUrl.replace(/\/$/, '');
        const url = `${sanitizedBaseUrl}/api/tracks/${target.id}`;

        try {
            log(`DELETE ${url}`);
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }

            log(`Deleted todo ${target.id}, status ${response.status}`);
            vscode.window.showInformationMessage('Todo deleted');
            await provider.refresh();
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            log(`Delete failed for ${target.id}: ${reason}`);
            vscode.window.showErrorMessage(`Failed to delete todo: ${reason}`);
        }
    });

    const updateTodoCommand = vscode.commands.registerCommand('engineer-plan.updateTodo', async (todo: TodoItem | ApiTodo) => {
        const target = todo instanceof TodoItem ? todo.todo : todo;
        if (!target?.id) {
            log('Update requested without todo id');
            return;
        }

        const name = await vscode.window.showInputBox({
            title: 'Update Todo Title',
            value: target.title,
            prompt: 'Enter task title',
            ignoreFocusOut: true,
        });
        if (name === undefined) {
            return;
        }

        const startInput = await vscode.window.showInputBox({
            title: 'Start (ISO with offset)',
            value: target.start,
            prompt: 'Example: 2025-11-26T08:11:00+08:00',
            ignoreFocusOut: true,
        });
        if (startInput === undefined) {
            return;
        }

        const endInput = await vscode.window.showInputBox({
            title: 'End (ISO with offset)',
            value: target.end,
            prompt: 'Example: 2025-11-26T09:11:00+08:00',
            ignoreFocusOut: true,
        });
        if (endInput === undefined) {
            return;
        }

        const statusOptions = ['not started', 'in progress', 'completed'];
        const statusItems = statusOptions.map((label) => ({ label }));
        const statusInput = await vscode.window.showQuickPick(statusItems, {
            title: 'Status',
            placeHolder: 'Select status',
            ignoreFocusOut: true,
            canPickMany: false,
        });
        if (statusInput === undefined) {
            return;
        }

        const token = await authManager.getToken();
        if (!token) {
            return;
        }

        const sanitizedBaseUrl = apiBaseUrl.replace(/\/$/, '');
        const url = `${sanitizedBaseUrl}/api/tracks/${target.id}`;

        try {
            log(`PUT ${url}`);
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    name: name || target.title,
                    start: startInput || target.start,
                    end: endInput || target.end,
                    status: statusInput?.label || target.rawStatus || target.status,
                }),
            });

            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }

            log(`Updated todo ${target.id}, status ${response.status}`);
            vscode.window.showInformationMessage('Todo updated');
            await provider.refresh();
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            log(`Update failed for ${target.id}: ${reason}`);
            vscode.window.showErrorMessage(`Failed to update todo: ${reason}`);
        }
    });

    const showTodoCommand = vscode.commands.registerCommand('engineer-plan.showTodo', (todo: ApiTodo) => {
        if (!todo) {
            return;
        }
        const statusText = todo.rawStatus || todo.status;
        const start = todo.start ? new Date(todo.start) : undefined;
        const end = todo.end ? new Date(todo.end) : undefined;
        const range = start && end
            ? `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`
            : undefined;
        const tags = todo.tags?.map((t) => t.name).filter(Boolean);

        const lines = [
            `### ${todo.title}`,
            `Status: ${statusText}`,
        ];
        if (range) {
            lines.push(`When: ${range}`);
        }
        if (tags?.length) {
            lines.push(`Tags: ${tags.join(', ')}`);
        }

        const md = new vscode.MarkdownString(lines.join('\n\n'));
        md.isTrusted = true;
        vscode.window.showInformationMessage(md.value, { modal: true });
    });

    const copyTodosCommand = vscode.commands.registerCommand('engineer-plan.copyTodos', async () => {
        const items = provider.getItems();
        const tagSet = new Set<string>();
        items.forEach((item) => item.todo.tags?.forEach((t) => { if (t.name) tagSet.add(t.name); }));
        const tagList = Array.from(tagSet).sort();

        const selectedTags = await vscode.window.showQuickPick(tagList.map((t) => ({ label: t })), {
            canPickMany: true,
            placeHolder: 'Select tags to include',
            title: 'Copy Todos',
        });
        if (selectedTags === undefined) {
            return;
        }
        if (selectedTags.length === 0) {
            vscode.window.showWarningMessage('No tags selected.');
            return;
        }

        const includeTime = await vscode.window.showQuickPick(
            [
                { label: 'Include time (HH:mm-HH:mm)', value: true },
                { label: 'Do not include time', value: false },
            ],
            { placeHolder: 'Include start-end time?', title: 'Copy Todos', canPickMany: false }
        );
        if (!includeTime) {
            return;
        }

        const tagNames = new Set(selectedTags.map((t) => t.label));
        const filtered = items
            .filter((item) => {
                const itemTags = item.todo.tags?.map((t) => t.name).filter(Boolean) ?? [];
                return itemTags.some((t) => tagNames.has(t));
            })
            .sort((a, b) => {
                const aTime = a.todo.start ? new Date(a.todo.start).getTime() : 0;
                const bTime = b.todo.start ? new Date(b.todo.start).getTime() : 0;
                return aTime - bTime;
            });

        if (filtered.length === 0) {
            vscode.window.showWarningMessage('No todos match the selected tags.');
            return;
        }

        const lines = filtered.map((item) => {
            const { icon } = resolveStatus(item.todo.status);
            const base = `${icon} - ${item.todo.title}`;
            if (!includeTime.value) {
                return base;
            }
            const range = formatTimeRange(item.todo.start, item.todo.end);
            return range ? `${base} (${range})` : base;
        });

        const text = lines.join('\n');
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage('Todos copied to clipboard');
    });

    context.subscriptions.push(
        output,
        view,
        refreshCommand,
        loginCommand,
        logoutCommand,
        createCommand,
        deleteTodoCommand,
        updateTodoCommand,
        showTodoCommand,
        openWebsiteCommand,
        copyTodosCommand,
        { dispose: () => clearInterval(autoRefreshHandle) }
    );
}

export function deactivate(): void {}
