# LINE rich menu

The persistent 6-tile menu for the 皖美育見你 OA. Two artifacts:

- `richmenu.json` — size + tile hit-areas + actions (the source of truth)
- `richmenu.png` — the 2500×1686 background, generated from `generate.mjs`

## Layout (3 columns × 2 rows)

| Tile | Action | Target |
|------|--------|--------|
| 喜帖 | uri | `https://wedding.zacharyzhuo.com/` (landing / digital invite) |
| RSVP | uri | rsvp LIFF `2010162827-KdWFjsBB` |
| 我的座位 | message `我的座位` | webhook placeholder (seating not built yet) |
| 抽獎 | uri | raffle LIFF `2010162827-Htyt8ShV` |
| 想對新人說 | uri | danmaku LIFF `2010162827-bxyt2qMx` |
| 悄悄話 | message `悄悄話` | webhook (gated by `thankyou_mode`, see `functions/api/line/webhook.ts`) |

The two `message` tiles post text into the chat, which the Messaging API
webhook (`functions/api/line/webhook.ts`) matches by keyword. When the seating
lookup LIFF exists, switch 我的座位 to a `uri` action and drop its placeholder
branch in the webhook.

## Regenerate the image

```sh
node scripts/richmenu/generate.mjs   # writes richmenu.png (needs sharp, already a dep)
```

## Deploy (Messaging API — needs LINE_CHANNEL_ACCESS_TOKEN)

```sh
set -a; source .env.local; set +a
T=$LINE_CHANNEL_ACCESS_TOKEN

# 1. create the menu object → returns { richMenuId }
RID=$(curl -s -X POST https://api.line.me/v2/bot/richmenu \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d @scripts/richmenu/richmenu.json | node -pe 'JSON.parse(require("fs").readFileSync(0)).richMenuId')

# 2. upload the image (note the api-data host)
curl -X POST "https://api-data.line.me/v2/bot/richmenu/$RID/content" \
  -H "Authorization: Bearer $T" -H "Content-Type: image/png" \
  --data-binary @scripts/richmenu/richmenu.png

# 3. set as the default menu for every follower (empty body needs Content-Length: 0)
curl -X POST "https://api.line.me/v2/bot/user/all/richmenu/$RID" \
  -H "Authorization: Bearer $T" -H "Content-Length: 0"
```

Rollback: `curl -X DELETE https://api.line.me/v2/bot/user/all/richmenu -H "Authorization: Bearer $T"`
unsets the default; `DELETE /v2/bot/richmenu/{RID}` removes a menu object.
