# TibiaHunts — fan-made wyszukiwarka hunting spotów w Tibii

Kompletna aplikacja webowa do wyszukiwania miejscówek do expienia w Tibii.
**Projekt fanowski — nie jest powiązany z CipSoft GmbH.**

## Uruchomienie

```bash
npm install
node server.js          # http://localhost:3000
ADMIN_TOKEN=twoj-token node server.js   # własny token panelu admina (domyślnie: tibia-admin-2026)
```

## Funkcje

| Moduł | URL | Opis |
|---|---|---|
| Strona główna | `/` | Panel „FIND YOUR NEXT HUNT", Popular Hunts, Best EXP/h, Best Profit, ostatnio aktualizowane |
| Lista + filtry | `/hunting-spots` | Filtry: profesja, level min/max, tryb, PACC/FREE, ryzyko, EXP/h, profit/h, waste, damage type, region, miasto, potwór + sortowanie |
| System rekomendacji | `/hunting-spots?vocation=MS&level=50&mode=solo` | TOP rekomendacje z match% (LEVEL + PROFESJA + SKILL + ML + EQUIPMENT + QUESTY + RYZYKO) |
| Karta spotu | `/hunt/<slug>` | Obraz gameplayu, statystyki, potwory (sprite'y z gry), wymagania, questy, gear/runy/potiony, trasa, tipsy, alternatywy, „WHERE TO HUNT NEXT?" |
| Mapa | `/map` | Interaktywna mapa świata Tibii (kafelki automapy tibiamaps.io), znaczniki spotów (realne współrzędne), miasta, depoty/banki/świątynie/blessy, piętra, zoom |
| Porównywarka | `/compare` | Do 5 spotów, tabela + wykresy EXP/h i profit/h |
| System party | `/party` | Skład do 8 graczy, role, rekomendacje dla drużyny z estymacją EXP/profit |
| Plan expienia | `/planner` | „CREATE MY HUNTING ROUTE": LEVEL X → Y + hunt + szacowany czas |
| SEO | `/hunting-spots/master-sorcerer`, `/elite-knight`, `/royal-paladin`, `/elder-druid`, `/monk`, `/level-50`, `/level-100`, `/level-200` | Strony per profesja i per level |
| Admin | `/admin` | CRUD spotów, upload screenów, import/eksport JSON, LAST UPDATED |
| Wyszukiwarka globalna | nagłówek | Spoty, potwory, miasta; rozumie frazy typu „Level 100 MS", „Profit hunt", „Solo EK" |
| SEO techniczne | `/sitemap.xml`, `/robots.txt` | title, meta description, Open Graph, JSON-LD, przyjazne URL |

## API

- `GET /api/spots?vocation=&level=&min=&max=&mode=&pacc=&risk=&minExp=&minProfit=&damage=&region=&monster=&sort=`
- `GET /api/spots/:id` · `POST /api/recommend` · `POST /api/party` · `POST /api/plan` · `POST /api/next-steps`
- `GET /api/search?q=` · `GET /api/spots-map-markers` · `GET /api/cities`
- Admin (nagłówek `X-Admin-Token`): `POST /api/spots`, `PUT/DELETE /api/spots/:id`, `POST /api/spots/import`, `GET /api/spots/export`, `POST /api/upload`

## Dane i ich źródła

- **EXP/h, profit/h** — pomiary społeczności z **TibiaPal.com** (tabele per profesja/level) i **Intibia.com** (zakresy EXP/profit), uzupełnione o TibiaRoute.com. TibiaPal zaznacza, że część danych pochodzi sprzed *Vocation Rebalance 2026* — wszystkie wartości są **szacunkowe**, co jest widoczne przy każdej miejscówce i w stopce.
- **Współrzędne** — plik `markers.json` projektu **tibiamaps.io** (realne współrzędne w grze). Znaczniki bez potwierdzonego markera mają `approx: true` i można je poprawić w panelu admina.
- **Sprite'y potworów** — zasoby gry Tibia (hostowane przez Intibia.com), zapisane lokalnie w `public/images/monsters/`.
- **Screeny gameplayu** — klatki z poradników wideo (link do filmu przy każdym spocie).

Baza (`data/spots.json`) jest zwykłym plikiem JSON — można ją edytować, importować i eksportować. Każda aktualizacja przez panel admina ustawia `lastUpdated` („LAST UPDATED: DD.MM.YYYY" na karcie).

## Obrazy i prawa

„Images / game assets: Tibia / CipSoft and respective sources." — wszystkie materiały przedstawiają rzeczywisty wygląd gry; strona nie imituje grafiki Tibii i nie podaje się za oficjalny produkt CipSoft.
