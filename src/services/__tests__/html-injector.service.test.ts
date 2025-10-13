import 'reflect-metadata';
import { container } from 'tsyringe';
import { HtmlInjector } from '../html-injector.service';
import { ConfigService } from '../config.service';

describe('HtmlInjector', () => {
  let htmlInjector: HtmlInjector;
  let configService: ConfigService;

  beforeEach(() => {
    container.clearInstances();
    configService = container.resolve(ConfigService);
    container.registerInstance(ConfigService, configService);
    htmlInjector = container.resolve(HtmlInjector);
  });

  it('should inject script into valid HTML', () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>Content</body>
</html>`;

    const result = htmlInjector.inject(html);
    
    expect(result).toContain('window.__JSX_TOOL_DEV_SERVER_WS_URL__');
    expect(result).toContain('</script>\n</head>');
  });

  it('should not inject into non-HTML content', () => {
    const json = '{"foo": "bar"}';
    const result = htmlInjector.inject(json);
    expect(result).toBe(json);
  });

  it('should not inject into HTML without DOCTYPE', () => {
    const html = '<html><head></head><body></body></html>';
    const result = htmlInjector.inject(html);
    expect(result).toBe(html);
  });

  it('should use custom injection point', () => {
    configService.setFromCliOptions({ injectAt: '</body>' });
    
    const html = `<!DOCTYPE html>
  <html>
  <head><title>Test</title></head>
  <body>Content</body>
  </html>`;

    const result = htmlInjector.inject(html);
    
    expect(result).toContain('</script>\n</body>');
    
    const headContent = result.substring(
      result.indexOf('<head>'),
      result.indexOf('</head>')
    );
    expect(headContent).not.toContain('<script>');
  });
});