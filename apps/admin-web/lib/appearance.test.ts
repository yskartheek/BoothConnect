import { APPEARANCE_SCRIPT } from './appearance';

describe('the pre-paint appearance script', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.transparency;
    localStorage.clear();
  });

  const run = () => new Function(APPEARANCE_SCRIPT)() as void;

  it('applies the saved theme and transparency', () => {
    localStorage.setItem('bc.theme', 'dark');
    localStorage.setItem('bc.transparency', 'reduced');
    run();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement).toHaveAttribute('data-transparency', 'reduced');
  });

  it('ignores anything else', () => {
    localStorage.setItem('bc.theme', '"><script>');
    run();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(document.documentElement).not.toHaveAttribute('data-transparency');
  });
});
