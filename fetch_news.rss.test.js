const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('rss-parser');
const { processRSS } = require('./fetch_news');

test('RSS article images are not replaced by later author images', async t => {
    const xml = `<?xml version="1.0"?>
        <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
          <channel>
            <title>Rajapinta</title><link>https://rajapinta.co</link>
            <image><url>https://rajapinta.co/logo.png</url><title>Rajapinta</title><link>https://rajapinta.co</link></image>
            <item>
              <title>Article</title><link>https://rajapinta.co/article</link>
              <pubDate>Tue, 20 Oct 2026 06:54:30 +0000</pubDate>
              <media:thumbnail url="https://rajapinta.co/wp-content/uploads/2026/10/cassandrahymers_7209609068_2524d9c272_k.jpg" />
              <media:content url="https://rajapinta.co/wp-content/uploads/2026/10/cassandrahymers_7209609068_2524d9c272_k.jpg" medium="image"><media:title>Article image</media:title></media:content>
              <media:content url="https://2.gravatar.com/avatar/author?s=96&amp;d=identicon" medium="image" width="96"><media:title>Author</media:title></media:content>
            </item>
            <item>
              <title>Self-closing image</title><link>https://rajapinta.co/second</link>
              <pubDate>Tue, 20 Oct 2026 06:54:30 +0000</pubDate>
              <media:thumbnail url="https://rajapinta.co/second.jpg" />
              <media:content url="https://rajapinta.co/second.jpg" medium="image" />
              <media:content url="https://2.gravatar.com/avatar/author" medium="image" />
            </item>
            <item>
              <title>Largest</title><link>https://rajapinta.co/third</link>
              <pubDate>Tue, 20 Oct 2026 06:54:30 +0000</pubDate>
              <media:content url="https://rajapinta.co/small.jpg" width="100" />
              <media:content url="https://rajapinta.co/large.jpg" width="500" />
              <media:content url="https://rajapinta.co/equal.jpg" width="500" />
            </item>
            <item>
              <title>Thumbnail</title><link>https://rajapinta.co/fourth</link>
              <pubDate>Tue, 20 Oct 2026 06:54:30 +0000</pubDate>
              <media:thumbnail url="https://rajapinta.co/thumbnail.jpg" />
            </item>
            <item>
              <title>Enclosure</title><link>https://rajapinta.co/fifth</link>
              <pubDate>Tue, 20 Oct 2026 06:54:30 +0000</pubDate>
              <enclosure url="https://rajapinta.co/enclosure.jpg" type="image/jpeg" />
            </item>
          </channel>
        </rss>`;
    t.mock.method(Parser.prototype, 'parseURL', function () { return this.parseString(xml); });
    const articles = [];
    await processRSS({ rssUrl: 'https://rajapinta.co/feed/', nameChecked: 'Rajapinta' }, articles);
    assert.deepEqual(articles.map(article => article.enforcedImage), [
        'https://rajapinta.co/wp-content/uploads/2026/10/cassandrahymers_7209609068_2524d9c272_k.jpg',
        'https://rajapinta.co/second.jpg',
        'https://rajapinta.co/large.jpg',
        'https://rajapinta.co/thumbnail.jpg',
        'https://rajapinta.co/enclosure.jpg'
    ]);
});
