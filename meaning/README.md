# Local song meaning manifests

The stream sidecar loads an optional, explicit meaning manifest when a track is
announced. This is the current local-only seam for lyric/transcript analysis;
the sidecar does not fetch lyrics or invent a narrative from a title.

Name a manifest after the first 32 hexadecimal characters of SHA-256 of the
track ID. If no track ID is stable, use SHA-256 of `title`, a NUL byte, and
`artist`. For example:

```powershell
"spotify:track:example" | % { $b=[Text.Encoding]::UTF8.GetBytes($_); $h=[Security.Cryptography.SHA256]::Create().ComputeHash($b); (($h | % ToString x2) -join '')[0..31] -join '' }
```

To create a correctly keyed, abstaining scaffold without calculating the hash
manually:

```powershell
npm run meaning:new -- --track-id "spotify:track:example" --language en
```

The scaffold is intentionally abstaining. Fill it only with verified lyric or
transcript evidence before setting `abstained` to `false`.

For verified timed `.lrc` evidence, `npm run meaning:import` applies a small
bounded English/Japanese vocabulary to expose safe person, place, object,
force, texture, and action handles. It does not translate lyrics or infer an
unrecognized story; unknown lines remain `symbol` motifs. Use
`--symbols-only` when importing evidence without even this bounded grounding.

The JSON shape is the `SongMeaning` contract in `src/director/semantic.ts`:

`language` is an optional BCP 47 tag for the evidence and labels (`ja`, `ko`,
`es-MX`, and so on). The renderer preserves that language; it does not translate
inside the display-rate loop. A future extractor may provide normalized semantic
roles plus translated display labels, but a missing translation must not cause the
director to invent a scene.

```json
{
  "revision": 1,
  "language": "en",
  "thesis": "A figure keeps moving toward a distant opening.",
  "abstained": false,
  "motifs": [
    {"id":"girl","kind":"person","label":"a girl","attributes":["red scarf"],"confidence":0.92,"source":"lyrics"},
    {"id":"field","kind":"place","label":"a wide field","attributes":["wind-bent grass"],"confidence":0.88,"source":"lyrics"},
    {"id":"horizon","kind":"symbol","label":"a luminous horizon","attributes":[],"confidence":0.66,"source":"inference"}
  ],
  "relations": [
    {"subject":"girl","verb":"runs through","object":"field","confidence":0.9,"source":"lyrics"}
  ],
  "sections": [
    {"index":0,"startSec":0,"endSec":24,"action":"runs through the field toward the luminous horizon","activeMotifs":["girl","field","horizon"],"activeRelations":["girl-runs-through-field"],"affect":["urgent","hopeful"],"confidence":0.87}
  ],
  "evidence": [
    {"source":"lyrics","text":"[aligned lyric or transcript span]","confidence":0.9,"startSec":8,"endSec":12}
  ]
}
```

An absent or invalid manifest is an intentional story abstention. The renderer
keeps the music-video shot grammar and audio-reactive motion, but withholds title
concepts from the image prompt; title words such as `iris` or `out` are not
evidence that those things happen in the song.

For a track such as `Spot`, the manifest—not the title—would carry the evidence:
motif `a dog`, place `a field`, relation `dog runs through field`, and a
timestamped lyric evidence span. That produces a dog running through the
visualization. Without that evidence, the system must not guess a dog from the
track name.
