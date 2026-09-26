/** Bounded undo/redo stack of immutable snapshots. */
export class History<T> {
  private undoStack: { label: string; state: T }[] = []
  private redoStack: { label: string; state: T }[] = []

  constructor(private readonly limit = 30) {}

  push(label: string, previous: T): void {
    this.undoStack.push({ label, state: previous })
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
  }

  undo(current: T): { label: string; state: T } | null {
    const entry = this.undoStack.pop()
    if (!entry) return null
    this.redoStack.push({ label: entry.label, state: current })
    return entry
  }

  redo(current: T): { label: string; state: T } | null {
    const entry = this.redoStack.pop()
    if (!entry) return null
    this.undoStack.push({ label: entry.label, state: current })
    return entry
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }
  get undoLabel(): string | undefined {
    return this.undoStack.at(-1)?.label
  }
  get redoLabel(): string | undefined {
    return this.redoStack.at(-1)?.label
  }
}
