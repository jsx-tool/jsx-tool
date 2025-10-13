import { injectable, inject } from 'tsyringe';
import { ConfigService } from './config.service';

@injectable()
export class HtmlInjector {
  constructor (
    @inject(ConfigService) private readonly config: ConfigService
  ) {}

  inject (html: string): string {
    const config = this.config.getConfig();

    const isValidHtml = html.includes('<html') && html.includes('<head');
    if (!isValidHtml) {
      return html;
    }

    const script = this.createInjectionScript();

    return html.replace(config.injectAt, script + config.injectAt);
  }

  private createInjectionScript (): string {
    const { wsHost, wsPort, wsProtocol } = this.config.getConfig();

    return `
<script>
  window.__JSX_TOOL_DEV_SERVER_WS_URL__ = '${wsProtocol}://${wsHost}:${wsPort}';
</script>
`;
  }
}
