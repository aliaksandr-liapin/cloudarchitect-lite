Describe your app in plain English. Get an AWS architecture checked against 25 rules, on your own key.

That is CloudArchitect Lite 0.2, an open-source tool I just released.

How it works:

- You describe the app and answer up to three clarifying questions.
- Claude designs it using only a curated catalog of 38 AWS services. If it needs something outside the catalog, the node is flagged as unresolved instead of invented.
- 25 deterministic rules (not the AI) check the result, for example a queue consumer without a dead-letter queue.
- You edit it on a canvas and export JSON, PNG or SVG.

It runs on your machine with Docker and your own Anthropic key. Daily and monthly spending limits are built in. In my tests a generation cost about $0.007 with Haiku and $0.045 with Sonnet.

It is early (pre-alpha), and the quality numbers have caveats that I wrote down in the repo.

Try the editor in your browser, no install: https://aliaksandr-liapin.github.io/cloudarchitect-lite/
Code and one-command install: https://github.com/aliaksandr-liapin/cloudarchitect-lite

Feedback is welcome, especially on architectures it gets wrong.

#aws #opensource #softwarearchitecture
