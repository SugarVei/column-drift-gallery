"""Bundle this static gallery into one offline HTML file (Python standard library only)."""
from pathlib import Path
import argparse
import base64
import json

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
args = parser.parse_args()

html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'styles.css').read_text(encoding='utf-8')
app = (root / 'app.js').read_text(encoding='utf-8')
data = (root / 'photos.js').read_text(encoding='utf-8').split('=', 1)[1].strip().rstrip(';')
photos = json.loads(data)
for photo in photos:
    asset = (root / photo['src']).resolve()
    if not asset.is_relative_to(root / 'assets'):
        raise ValueError('Photo must be inside the assets directory')
    photo['src'] = 'data:image/jpeg;base64,' + base64.b64encode(asset.read_bytes()).decode('ascii')
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>')
html = html.replace('<script src="photos.js" defer></script>', '')
html = html.replace('<script src="app.js" defer></script>', '')
scripts = '<script>window.DEFAULT_PHOTOS = ' + json.dumps(photos, separators=(',', ':')) + ';</script>\n'
scripts += '<script>\n' + app.replace('</script', '<\\/script') + '\n</script>\n'
html = html.replace('</body>', scripts + '</body>')
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html, encoding='utf-8')
print(f'Created {args.output.name}: {args.output.stat().st_size:,} bytes')
