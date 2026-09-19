export type NoticeEvent =
  | { kind: "created"; message: string; duration: number | undefined }
  | { kind: "updated"; message: string }
  | { kind: "hidden" };

export const noticeEvents: NoticeEvent[] = [];

export function resetNoticeEvents(): void {
  noticeEvents.length = 0;
}

export class Notice {
  constructor(message: unknown, duration?: number) {
    noticeEvents.push({ kind: "created", message: String(message), duration });
  }

  setMessage(message: unknown): this {
    noticeEvents.push({ kind: "updated", message: String(message) });
    return this;
  }

  hide(): void {
    noticeEvents.push({ kind: "hidden" });
  }
}

export class Plugin {
  app: any;

  constructor(app: any) {
    this.app = app;
  }

  addSettingTab(): void {}

  registerEvent(): void {}

  registerObsidianProtocolHandler(): void {}

  async loadData(): Promise<unknown> {
    return undefined;
  }

  async saveData(): Promise<void> {}
}

export class PluginSettingTab {
  containerEl = { empty(): void {} };

  constructor() {}
}

class Slider {
  setLimits(): this {
    return this;
  }

  setValue(): this {
    return this;
  }

  setDynamicTooltip(): this {
    return this;
  }

  onChange(): this {
    return this;
  }
}

export class Setting {
  constructor() {}

  setName(): this {
    return this;
  }

  addSlider(callback: (slider: Slider) => void): this {
    callback(new Slider());
    return this;
  }
}

type RequestUrlImplementation = (request: unknown) => Promise<unknown>;

let requestUrlImplementation: RequestUrlImplementation = async () => {
  throw new Error("requestUrl was not configured for this test.");
};

export function setRequestUrlImplementation(implementation: RequestUrlImplementation): void {
  requestUrlImplementation = implementation;
}

export function resetRequestUrlImplementation(): void {
  requestUrlImplementation = async () => {
    throw new Error("requestUrl was not configured for this test.");
  };
}

export function requestUrl(request: unknown): Promise<unknown> {
  return requestUrlImplementation(request);
}
