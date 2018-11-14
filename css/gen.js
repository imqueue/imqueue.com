const fs = require('fs');
fs.readFile('fontello.css', { encoding: 'utf8' }, (err, data) => {
    if (err) {
        throw new Error('Can not open css file!');
    }
    let html = `<!doctype html>
<html>
<head>
      <meta charset="utf-8">
      <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
      <title>Fontello Icons</title>
      <link href='fontello.css' rel='stylesheet'>
</head>
<body style="font-size: 2em">
`;
    for (let line of data.match(/\/\*\s*:icons\s*\*\/([\s\S]*?)\/\*\s*:icons\s*\*\//)[1].split(/\r?\n/)) {
        if (line.replace(/\s+/, '')) {
            const name = line.split(/\./)[1].split(/:/)[0];
            html += `<i class="${name}" title="${name}"></i>\n`;
        }
    }
    html += '</body></html>';
    fs.writeFileSync('icons.html', html, { encoding: 'utf8' });
});