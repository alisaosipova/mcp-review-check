# Findings 2026-11-01: mcp-review-check 0.1.0 (final)

> Part of [SPEC.md](SPEC.md). Every row links to its raw finding (`evidence/01-find-raw/<id>.json`) and verifier votes (`evidence/02-verify/<id>.json`; critic items C### in `evidence/03-critic/`). Verdict rules are in SPEC §3.2. Content is in Russian as produced by the reviewers; identifiers, paths and code are English.

## 0. Summary

| Verdict | Count |
|---|---|
| confirmed | 117 |
| disputed | 3 |
| refuted | 26 |
| unverified | 0 |
| improvements (not verified, see §4) | 77 |

Rounds: F### = round 1 (Find), C### = round-1 critic, R### = round 2 (untouched areas). 10 round-1 disputed findings were settled by round-2 arbiters (`evidence/04-round2/arbiter/`); their rows carry an ARBITER vote. Round-2 raw findings: `evidence/04-round2/find/`, votes: `evidence/04-round2/verify/`.

## 1. Confirmed

| ID | Sev | Kind | File | Title |
|---|---|---|---|---|
| C003 | medium | bug | `src/connect.ts:409` | SRV-018 не видит JSON-логи (pino/winston/bunyan) в stdout: любая валидная JSON-строка считается MCP-сообщением |
| F018 | medium | bug | `src/probe/wire.ts:60` | GET-проба переиспользует живую сессию SDK → 409 от эталонного SDK-сервера → ложное SPEC-005 |
| F019 | medium | bug | `src/probe/network.ts:107` | Same-host редирект (trailing slash) ломает все сырые пробы: ложные SPEC-005/SPEC-007, пропуск SRV-008, неверная era |
| F020 | medium | bug | `src/rules/util/wwwAuth.ts:38` | Незакавыченный URL в WWW-Authenticate порождает фантомный challenge и обрезанный resource_metadata |
| F021 | medium | bug | `src/protocol/trace.ts:189` | SRV-010 latency: timings[method] пополняется всеми пробами (origin, badVersion, invalid-token, редирект-хопы) |
| F023 | medium | bug | `src/probe/active.ts:45` | wrongTypeValue для union-/нетипизированных схем даёт валидное значение → ложное RT-002 |
| F038 | medium | bug | `src/rules/auth.ts:508` | AUTH-020: страница логина, содержащая строку redirect_uri, считается отказом в redirect_uri (claude error) |
| F041 | medium | bug | `src/rules/spec.ts:252` | SPEC-011: при era='modern' через discSignal (400/-3202x) `discoverRaw` не задан — сообщение «result is not an object» вводит в заблуждение |
| F062 | medium | bug | `src/rules/schema.ts:27` | TOOL-017: $schema с «другой» схемой URL (https draft-07 / http 2020-12) принимается регуляркой, но Ajv его не знает — ложный error «does not compile» |
| F063 | medium | bug | `src/rules/tools.ts:233` | TOOL-023: method-параметр через $ref не разворачивается — пропуск ошибки «mixing safe and unsafe methods» |
| F064 | medium | bug | `src/rules/tools.ts:72` | TOOL-004: слова «top», «preferred», «official», «leading» как токены имени дают ложные «promotional» warning на обычных доменных именах |
| F065 | medium | bug | `src/rules/tools.ts:309` | TOOL-026: параметр `body`/`payload` трактуется как raw-request — ложное срабатывание на create_issue/post_message/send_email |
| F082 | medium | bug | `src/rules/policy.ts:29` | POL-002: regex MEDIA без завершающего \b — create_article, clipboard, voicemail считаются генерацией медиа |
| F083 | medium | bug | `src/rules/policy.ts:23` | POL-001: MONEY_NAME матчится как подстрока сырого имени — bestsellers/stakeholders/send_email |
| F084 | medium | bug | `src/rules/util/html.ts:62` | extractOrigins: CSS-regex `url\(` с флагом i ловит JS `new URL("https://…")` как resource-origin с confidence tag |
| F087 | medium | bug | `src/rules/data.ts:47` | DATA-001: `transcript` в STRONG_CONVO → error на инструментах транскрипции встреч/звонков |
| F088 | medium | bug | `src/rules/data.ts:93` | DATA-002: голое `memory` после read/access/retrieve → «Read the memory usage of the VM» = доступ к памяти Claude |
| F093 | medium | bug | `src/rules/injection.ts:254` | INJ-007: паттерн `(use\|call\|invoke\|ask) (the )?X (connector\|plugin\|app\|integration)` ловит самоссылку «Use this app to …» |
| F115 | medium | security | `src/report/text.ts:97` | Терминальная инъекция: ANSI/OSC/CR из данных сервера печатаются в text-отчёт без экранирования |
| F116 | medium | security | `src/redact.ts:55` | Cookie-заголовок редактируется только целиком: отдельное значение cookie (session id), эхо-возвращённое сервером, утекает |
| F119 | medium | bug | `src/protocol/trace.ts:23` | Секреты длиной 4–5 символов заменяются внутри слов (sk-test → sk-«redacted», attestation → at«redacted»ation) |
| F135 | medium | security | `src/report/text.ts:52` | Инъекция ANSI-escape и GitHub workflow-команд через серверные строки в текстовом отчёте |
| R002 | medium | bug | `src/connect.ts:656` | Остановка --max-duration во время connect stdio теряет stderr сервера, хотя в fix SRV-003 написано, что он показан |
| R007 | medium | bug | `src/connect.ts:217` | Ошибка SSE-fallback теряется: legacy SSE с OAuth выдаётся за «HTTP 404 not an MCP endpoint», auth-проба не запускается |
| R008 | medium | bug | `src/protocol/trace.ts:185` | SRV-010 измеряет время до заголовков: для SSE-ответов (дефолт SDK Streamable HTTP) и legacy SSE (202) задержка не видна |
| R009 | medium | security | `src/probe/wire.ts:73` | Для legacy HTTP+SSE Origin-пробы пропускаются, и SRV-008 молча «проходит» на локальных SSE-серверах (DNS rebinding) |
| R032 | medium | bug | `src/rules/apps.ts:134` | APPS-006: wildcard на многоуровневых публичных суффиксах (`https://*.co.uk`, `*.com.au`) и общих облачных доменах не считается overly broad |
| R046 | medium | bug | `src/protocol/recording.ts:25` | [Переоценка F141 + F033] 100 МБ не-JSON строк в stdout роняют линтер с heap OOM (exit 134, отчёта нет); основной источник роста памяти — transportErrors, а не nonJson |
| C001 | low | bug | `src/connect.ts:120` | stdio/HTTP-сервер, умерший сразу после initialize, получает PASS 100/100 и exit 0, если в capabilities нет tools |
| C002 | low | security | `src/probe/active.ts:80` | --active: дубликат имени обходит safety-контракт — вызывается имя, у которого другая запись destructiveHint:true |
| F001 | low | bug | `src/cli.ts:243` | --bearer / MCP_REVIEW_CHECK_TOKEN / --header при --stdio молча выставляют options.authenticated=true и отключают RT-009 |
| F002 | low | bug | `src/cli.ts:137` | Имя заголовка в --header не валидируется: невалидное имя даёт exit 3 «could not connect» вместо usage error |
| F003 | low | bug | `src/cli.ts:267` | URL с userinfo (https://user:pass@host/mcp) принимается, но fetch его отвергает — всегда exit 3 с невнятной причиной |
| F004 | low | bug | `src/cli.ts:282` | --active-auth, --tool-args, --sarif-location молча принимаются там, где не действуют (например --active-auth при --stdio печатает пугающий DCR-notice) |
| F005 | low | bug | `src/cli.ts:241` | --header "Authorization: …" вместе с --bearer: оба заголовка уходят на сервер и склеиваются в «Bearer A, Bearer B» |
| F006 | low | bug | `src/connect.ts:314` | 401 при --header (API-key/custom auth) без --bearer даёт coverage 'auth-required' / «server requires OAuth» вместо «credentials rejected» |
| F008 | low | bug | `src/cli.ts:261` | Несуществующий --cwd даёт «spawn node ENOENT» (выглядит как отсутствие node), exit 3 |
| F009 | low | bug | `src/cli.ts:327` | --output "" молча игнорируется: отчёт уходит в stdout |
| F010 | low | bug | `src/cli.ts:215` | `--stdio foo -- node x` даёт нерелевантное «expected a single <url>» |
| F024 | low | bug | `src/protocol/trace.ts:74` | Строгое сравнение id в SSE-watcher: ответ с id другого типа заставляет ждать полный timeout на каждый запрос |
| F027 | low | bug | `src/rules/util/net.ts:24` | isNonPublicIPv6 не распознаёт несжатые/hex-формы loopback и mapped-адресов, multicast и documentation-префикс |
| F028 | low | bug | `src/protocol/trace.ts:66` | parseSseMessages не поддерживает CR-only разделители строк из спецификации SSE |
| F039 | low | bug | `src/rules/spec.ts:441` | SPEC-018: зарезервированные префиксы `modelcontextprotocol.io/`, `mcp.dev/`, `mcp/` не обнаруживаются |
| F040 | low | bug | `src/rules/spec.ts:363` | SPEC-016: флаг `modern` берётся из заголовка НАШЕГО запроса, а не из эры сервера — legacy-сервер получает ошибку про «2026-07-28 response» |
| F042 | low | bug | `src/rules/auth.ts:346` | AUTH-012: при CIMD без "none" и без DCR выдаются два противоречивых claude-warning |
| F043 | low | bug | `src/rules/auth.ts:305` | AUTH-010: self-signed локальный AS в local mode остаётся error на всех платформах, тогда как SRV-001 для того же сертификата даёт Deploy-time info |
| F045 | low | bug | `src/rules/auth.ts:406` | AUTH-015 игнорирует DPoP-challenge, хотя AUTH-002/AUTH-013 принимают схему dpop |
| F061 | low | docs-mismatch | `src/rules/auth.ts:80` | AUTH-002: design §2.8 обещает «chatgpt and spec error» при legacy discovery, код даёт spec=warning |
| F066 | low | bug | `src/rules/schema.ts:224` | TOOL-021: для узла без `type` (например `{ $ref, 'x-mcp-header' }`) сообщение «x-mcp-header on a undefined property» |
| F067 | low | bug | `src/rules/tools.ts:122` | TOOL-006: пустая строка `title: ''` затеняет `annotations.title` (`??` не считает '' отсутствующим) |
| F068 | low | bug | `src/rules/tools.ts:161` | TOOL-008: подсчёт слов по пробелам ломается для CJK/тайского — полноценное описание помечается «only 1 words» |
| F069 | low | bug | `src/rules/annotations.ts:109` | TOOL-014: двойное срабатывание (a)+(b) на одной причине и срабатывание (b) без объекта annotations вопреки комментарию у (e) |
| F070 | low | bug | `src/rules/schema.ts:177` | TOOL-019: $ref на embedded resource с собственным `$id` внутри `$defs` считается «сетевой» ссылкой |
| F071 | low | bug | `src/rules/util/schemaWalk.ts:52` | walkSchema/schemaMetrics не обходят `dependentSchemas`, `dependencies` (schema-форма) и `additionalItems` — пропуски в TOOL-009/021/022/015/020 |
| F073 | low | bug | `src/rules/tools.ts:480` | TOOL-031: корневой `$ref` в outputSchema не разворачивается — ложный error «lacks a required string id» |
| F074 | low | bug | `src/rules/schema.ts:153` | TOOL-018: схема только с `patternProperties`/`propertyNames`/`unevaluatedProperties` помечается как «takes no parameters» |
| F085 | low | bug | `src/rules/runtime.ts:237` | RT-010: токены ищутся только в JSON-распарсенных корнях — секрет в обычном тексте результата не детектируется |
| F086 | low | bug | `src/rules/data.ts:96` | DATA-003: SECRET_NAMES заякорен на всё имя — new_password, db_password, github_token, credentials не ловятся |
| F089 | low | bug | `src/rules/data.ts:132` | DATA-005: имя `address` трактуется как геолокация — email/IP/wallet/contract address |
| F090 | low | bug | `src/rules/injection.ts:73` | INJ-001: исключение emoji-ZWJ не покрывает последовательности с VS16/модификатором тона кожи (❤️‍🔥, 👩🏽‍💻, 🏳️‍🌈) |
| F091 | low | bug | `src/rules/injection.ts:111` | INJ-002: единицы измерения с греческой буквой (μs, kΩ, ΔT, μg) — ложный homoglyph |
| F092 | low | bug | `src/rules/injection.ts:226` | INJ-006: `better than\|superior to` без контекста — «rating better than the threshold» = принижение конкурентов |
| F094 | low | bug | `src/rules/injection.ts:307` | INJ-009: «Follow the setup instructions in the README» / «apply the rules defined in the config» = подтягивание инструкций извне |
| F095 | low | bug | `src/rules/injection.ts:199` | INJ-005 (warning-ветки): `user` как прилагательное и «You are now connected» |
| F096 | low | bug | `src/rules/injection.ts:303` | INJ-008: «Use this tool for any question about billing» — тематически ограниченный триггер считается overly broad |
| F097 | low | bug | `src/rules/injection.ts:255` | INJ-007: паттерн брендов `(slack\|github\|…) (tool\|connector)` флагует first-party сервер того же бренда |
| F098 | low | bug | `src/rules/data.ts:80` | DATA-001 текстовая эвристика: «Send all messages matching the filter» в мессенджер-инструментах |
| F099 | low | bug | `src/rules/util/html.ts:105` | POL-004: extractLinks собирает любой `href=`, включая `<link rel=stylesheet>` — pricing.css = upsell |
| F110 | low | bug | `src/rules/injection.ts:180` | INJ-004: percent-encoded не-ASCII в URL-примере (кириллица/CJK) = «encoded payload» |
| F111 | low | bug | `src/rules/injection.ts:221` | INJ-006 паттерн 2: «rather than the default full web page» — не стиринг |
| F117 | low | security | `src/redact.ts:48` | Basic-авторизация: декодированный пароль не редактируется |
| F118 | low | bug | `src/redact.ts:114` | Полный уровень редакции (--env) заменяет обычные слова по всему отчёту: production, debug, версии, пути, hostname |
| F121 | low | bug | `src/rules/manual.ts:67` | OAuth-пункты чеклиста (MAN-007/008/013/014/026/028) пропадают при legacy discovery без PRM |
| F122 | low | bug | `src/report/sarif.ts:52` | SARIF level берётся из максимальной severity по всем платформам, а не по gated — code scanning покажет error там, где exit code = PASS |
| F123 | low | bug | `src/report/sarif.ts:39` | Результат с ruleId 'INTERNAL' ссылается на правило, отсутствующее в tool.driver.rules |
| F124 | low | bug | `src/rules/engine.ts:109` | Исключение в правиле, не относящемся к --target, глотается без следа и без учёта в score |
| F136 | low | bug | `src/protocol/legacy.ts:53` | RangeError (Maximum call stack) при странице tools/list с ≥~125k элементов → падение линтера с exit 3 |
| F137 | low | security | `src/protocol/modern.ts:164` | OOM: rawPages удерживает до 100 страниц × 64 МБ, capSnapshot их не режет |
| F138 | low | security | `src/protocol/trace.ts:486` | Legacy (SDK) путь читает тела ответов без ограничения размера — лимиты линтера не действуют |
| F139 | low | security | `src/connect.ts:125` | Число resources/read для ui:// не ограничено; каждое чтение до 64 МБ удерживается до capSnapshot |
| F141 | low | security | `src/connect.ts:437` | Непомерный рост nonJson/buf для stdio: все не-JSON строки stdout накапливаются без лимита, Buffer.concat квадратичен |
| F144 | low | bug | `src/probe/active.ts:83` | --tool-args: поиск аргументов по имени инструмента через прототип (`constructor`, `__proto__`, `toString`) |
| F148 | low | docs-mismatch | `README.md:66` | README одновременно утверждает «не опубликовано в npm» и даёт рецепты через npx mcp-review-check@0.1 |
| F149 | low | docs-mismatch | `SECURITY.md:30` | «What the tool sends» для --active не упоминает три дополнительных соединения с поддельным clientInfo.name и лимит 50 инструментов |
| F152 | low | docs-mismatch | `README.md:7` | Число правил «144» захардкожено в README и spec.md и не синхронизируется генератором |
| F153 | low | docs-mismatch | `CHANGELOG.md:9` | CHANGELOG в формате Keep a Changelog без link-определений; раздел Changed в первом релизе описывает изменения относительно неопубликованного baseline |
| F158 | low | bug | `test/pack.test.ts:192` | pack.test.ts требует git и каталог .git без skipIf — npm test падает из архива исходников |
| R001 | low | bug | `src/connect.ts:509` | Сервер, ждущий закрытия stdin, превращает полностью завершённую проверку в INCOMPLETE/exit 3 с ложной фазой «active tool calls» (даже без --active) |
| R003 | low | bug | `src/connect.ts:649` | Остановленный snapshot теряет уже собранные данные (active-вызовы, wire probes, observedErrors, modernResults), и часть правил молча проходит, а не помечается stopped |
| R004 | low | bug | `src/cli.ts:362` | После Ctrl+C/SIGTERM проверка stdio продолжается, пишет полный отчёт в --output с coverage 'ok' и только потом умирает с 130 |
| R005 | low | bug | `src/cli.ts:352` | isMain ложен при запуске без расширения (`node dist/cli`): CLI молча ничего не делает и выходит с 0 |
| R006 | low | docs-mismatch | `README.md:105` | Exit-коды 129/130/131/143 (выход по сигналу) не описаны ни в README, ни в --help |
| R010 | low | bug | `src/protocol/modern.ts:143` | ModernClient принимает result с чужим id (одиночный JSON и SSE fallback msgs[0]) и не сообщает о несовпадении |
| R013 | low | bug | `src/cli.ts:324` | Неполная проверка (auth-required / token-rejected) завершается exit 0 «PASS» и без GitHub-аннотации: просроченный или отсутствующий токен в CI даёт зелёный job |
| R016 | low | bug | `src/explain.ts:36` | --list-rules <prefix> --format markdown печатает пустую таблицу правил или чек-листа (только заголовок) |
| R019 | low | docs-mismatch | `README.md:105` | Таблица exit codes не упоминает, что непредвиденное исключение линтера тоже даёт exit 3 |
| R020 | low | docs-mismatch | `README.md:282` | --ignore повышает score, а README говорит только об исключении из exit code |
| R021 | low | bug | `src/cli.ts:326` | Плюрализация в summary-строке: «1 errors · 1 warnings» |
| R023 | low | bug | `src/report/github.ts:237` | Пустое имя инструмента ('') даёт аннотацию с title «RULE-ID » без субъекта |
| R024 | low | bug | `src/limits.ts:29` | TEXT_CAP → TOOL-017: обрезка длинного `pattern` делает валидную схему «does not compile» (spec error) |
| R025 | low | bug | `src/limits.ts:29` | TEXT_CAP → TOOL-003/TOOL-001/TOOL-002: обрезка имени даёт ложные дубли и неверную длину в сообщениях |
| R026 | low | bug | `src/limits.ts:39` | TEXT_CAP → APPS-001/003/007/019: обрезанный ui:// URI или имя расходятся с необрезанными ключами resourceReads и toolsWithoutUi |
| R027 | low | bug | `src/limits.ts:54` | HTML_CAP → APPS-014: ложное «uses the ext-apps App but never calls connect()» для виджета больше 2 MB |
| R028 | low | security | `src/limits.ts:25` | capStrings не ограничивает ключи объектов: имена свойств и ключи patternProperties любой длины проходят мимо капа |
| R030 | low | bug | `src/rules/util/ui.ts:129` | Content item с uri, отличным от запрошенного: _meta item-а игнорируется, HTML-правила молча пропускаются, APPS-005/012 дают ложные error |
| R033 | low | bug | `src/rules/apps.ts:141` | APPS-006: незашифрованный `ws://` в connectDomains не помечается (проверяется только `http:`) |
| R034 | low | bug | `src/rules/apps.ts:140` | APPS-006: wildcard в середине или в конце хоста (`https://api.*.example.com`, `https://*.example.*`) и `data:`/`blob:` обрабатываются неверно |
| R037 | low | bug | `src/rules/apps.ts:342` | APPS-015: navigator.clipboard помечается даже при объявленном `ui.permissions.clipboardWrite`; alert() в комментарии тоже срабатывает |
| R038 | low | bug | `src/rules/apps.ts:418` | APPS-019 приписывает UI-капабилити отсутствие инструмента, которого нет и в обычном новом соединении (toolsFreshConnection) |
| R040 | low | bug | `src/rules/apps.ts:363` | APPS-016: нет Google Analytics/GTM в списке трекеров; `data-alt=` засчитывается как alt |
| R041 | low | bug | `src/rules/apps.ts:286` | APPS-012: общий sandbox-домен в другом регистре (`HTTPS://WEB-SANDBOX.OAIUSERCONTENT.COM`) не распознаётся |
| R042 | low | bug | `src/rules/apps.ts:380` | APPS-017: `_meta.ui` не-объект (строка, массив) молча превращается в `{}` — нет находки о типе |
| R043 | low | docs-mismatch | `src/rules/apps.ts:144` | APPS-006 выдаёт claude-находку (CDN info), хотя правило, RULES.md и spec.md заявляют только chatgpt/spec |
| R044 | low | bug | `src/connect.ts:319` | Auth probe разбирает challenge из preflight 403 без WWW-Authenticate и игнорирует настоящий 401 с Bearer-challenge: ложные AUTH-002/004/013 |
| R045 | low | bug | `src/connect.ts:300` | 401 на listing не запускает auth probe: при публичных server/discover или initialize AUTH-правила пропускаются, а 401 превращаются в ложные SPEC-ошибки |
| R047 | low | bug | `src/connect.ts:423` | stdio: сообщение больше 10 МБ (лимит SDK ReadBuffer по умолчанию) рвёт соединение, а причина теряется: «Connection closed», ложный APPS-001 и каскад «Not connected» |
| R048 | low | bug | `src/connect.ts:468` | Неудачный stdio-initialize выбрасывает собранный не-JSON stdout: SRV-018 молчит, а диагноз сводится к «Request timed out» |

### C003 [medium/bug] SRV-018 не видит JSON-логи (pino/winston/bunyan) в stdout: любая валидная JSON-строка считается MCP-сообщением

**Where.** `src/connect.ts:409` (reviewer: critic)

**What.** Фильтр `nonJson` в `connectStdio` (src/connect.ts:444, `isJsonLine` на :408) пропускает любую строку, которая парсится как JSON. Поэтому структурированные логи (pino/winston/bunyan) в stdout не попадают в SRV-018. SDK отвергает такие строки схемой `JSONRPCMessageSchema`, и ZodError уходит в `rec.transportErrors`, которые ни одно правило не читает. Это расходится со спекой (docs/design/spec.md:248-249, 1183): по ней SRV-018 должен строиться на ошибках разбора из `onerror`.

**Failure scenario.** Node-сервер с pino, настроенным на stdout, проходит SRV-018 без замечаний, а в Claude Desktop сыплет ошибками парсинга.

**Evidence.** Сервер, пишущий перед каждым ответом `{"level":30,"time":…,"msg":"request <method>"}` в stdout: `node dist/cli.js --format json --stdio "node logsrv.mjs pino"` → findings: SRV-002,SRV-002,TOOL-028; SRV-018 не пропущен (skipped пуст) и не сработал.

**Repro (verifier).**

```
Тестовый сервер /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/logsrv.mjs: McpServer из SDK с подменённым `process.stdout.write`, который перед каждым JSON-RPC-сообщением пишет строку `{"level":30,"time":...,"msg":"out"}`.
Команда: `node dist/cli.js --format json --stdio "node <scratchpad>/logsrv.mjs" 2>/dev/null`
Findings: TOOL-006,TOOL-011,TOOL-012,SPEC-009,TOOL-008,SRV-002,SRV-002,TOOL-005,TOOL-008,TOOL-018
SRV-018 в JSON-отчёте не встречается вообще, ни среди findings, ни среди skipped (результат поиска по шаблону `/SRV-018[^}]*/g`: null).
```

**Suggested fix.** Считать «не-MCP» строку, которая не парсится как JSON ИЛИ не является объектом/массивом с jsonrpc:'2.0' (или не проходит JSONRPCMessageSchema); альтернативно засчитывать rec.transportErrors с ZodError/SyntaxError в SRV-018.

**Verifier votes.**

- *reader*: confirmed (conf 0.9) — Опровергнуть не удалось. src/connect.ts:408-409: `isJsonLine` проверяет только, что `JSON.parse` не бросил исключение. На строке 444 в `nonJson` попадает лишь строка, которая не парсится, а только `nonJson` идёт в `snap.transport.stdio.nonJsonStdout` (строки 475/510/656). Других источников у правила SRV_018 (src/rules/server.ts:447-458) нет. `RecordingTransport.transportErrors` (src/protocol/recording.ts:14,25) правила не читают (grep не находит ни одного места чтения). Выше по стеку этот случай тоже не обрабатывается. Утверждение согласуется со спекой и не противоречит ей: в docs/design/spec.md:248-249 сказано, что SRV-018 должен ловить ошибки разбора, которые SDK отдаёт через `transport.onerror`/`client.onerror`, а в :1183 — «Capture … `onerror` parse failures for SRV-018». ReadBuffer в SDK проверяет каждую строку схемой `JSONRPCMessageSchema`, поэтому лог pino вызывает ZodError в `onerror`. Значит, по замыслу спеки такой лог должен давать находку, а реализация сузила проверку до «строка не парсится как JSON». В test/ нет теста, который закреплял бы пропуск JSON-логов как намеренное поведение: фикстура leaky-server и тесты e2e-stdio, redaction и ci-output проверяют только строки, которые вообще не являются JSON. Номер строки актуален (определение `isJsonLine` на 408-409, применение на 444). Severity medium оставляю: правило действует только для spec (spec=error), но ложноотрицательный результат приходится на самый частый реальный сценарий (pino/winston пишут в stdout). Уточнение к evidence автора: в моём repro список findings другой, потому что сервер другой, но вывод тот же — SRV-018 не сработал и не попал в skipped.
- *repro*: confirmed (conf 0.93) — Утверждение подтверждено и кодом, и запуском. В src/connect.ts:408-410 isJsonLine лишь проверяет, что JSON.parse не бросил исключение. В :444 строка попадает в nonJson только при `!isJsonLine(line)`. SRV-018 (src/rules/server.ts:446-458) смотрит исключительно на snap.transport.stdio.nonJsonStdout, поэтому любой валидный JSON, даже без jsonrpc:'2.0', не считается посторонним выводом. Я собрал два одинаковых мини-сервера, они отличаются только строкой лога в stdout перед каждым ответом. С pino-подобным JSON-логом SRV-018 не сработал и в skipped его нет. С текстовым логом SRV-018 срабатывает и находит 6 строк. Значит, правило активно и ложноотрицательный результат даёт именно фильтр isJsonLine. Severity medium подходит: правило со spec-severity error молча пропускает самый частый реальный случай (pino/winston/bunyan в stdout), но других правил это не ломает. Оговорка: по коду я не проверял, что SDK отвергает такие строки через JSONRPCMessageSchema и складывает их в transportErrors. На результат репродукции это не влияет.

### F018 [medium/bug] GET-проба переиспользует живую сессию SDK → 409 от эталонного SDK-сервера → ложное SPEC-005

**Where.** `src/probe/wire.ts:60` (reviewer: protocol-probe)

**What.** GET-проба (src/probe/wire.ts:56-62) отправляет GET с `mcp-session-id` живой SDK-сессии. Для этой сессии StreamableHTTPClientTransport уже открыл standalone SSE GET. Эталонный SDK-сервер с sessionIdGenerator отвечает на второй GET `409` (application/json). SPEC-005 не учитывает 409 и даёт ложный warning «GET returned 409 (application/json); expected 200 text/event-stream or 405» на любом корректном сервере с сессиями на базе SDK.

**Evidence.** Живой репро (loopback SDK-сервер с sessionIdGenerator, dist/connect.js buildSnapshot + runRules): `preflight 200 … get 409 application/json` → `SPEC-005 warning GET returned 409 (application/json); expected 200 text/event-stream or 405`. Код: wire.ts:56-62 `if (http.sessionId) session['mcp-session-id'] = http.sessionId; … p.get = tracer.request('get', url, { method: 'GET', headers: { ...authHeaders, ...session, accept: 'text/event-stream' } …`.

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f018.mjs поднимает loopback-сервер: McpServer + StreamableHTTPServerTransport с sessionIdGenerator=randomUUID, SDK 1.32.1. Затем вызывает dist/connect.js buildSnapshot({target:{kind:'http',url}}) и runRules(snap, RULES). Вывод:
preflight POST 200 text/event-stream
sdk GET GET 200 text/event-stream
get GET 409 application/json
badVersion POST 400 application/json
probe get: 409 application/json sessionId? true
[{"id":"SPEC-005","sev":"warning","msg":"GET returned 409 (application/json); expected 200 text/event-stream or 405"}]
```

**Suggested fix.** Либо делать GET-пробу без `mcp-session-id` (тогда ожидаем 400/405/200), либо открывать для неё отдельную сессию (POST initialize → GET → DELETE), либо трактовать 409 при наличии sessionId как «stream уже открыт = SSE поддерживается» в wire.ts (пометить в ProbeObservation) и/или в SPEC-005. Добавить e2e-тест против SDK-сервера с сессиями.

**Verifier votes.**

- *reader*: confirmed (conf 0.95) — Подтверждено кодом и живым repro. Строка src/probe/wire.ts:60 актуальна: GET-проба переиспользует `mcp-session-id` основной SDK-сессии (wire.ts:57, сессию передаёт src/connect.ts:348 `sessionId: conn.sessionId`). SDK-клиент (@modelcontextprotocol/sdk 1.32.1, client/streamableHttp.js:386-390) после 202 на `notifications/initialized` сам открывает standalone GET SSE. SDK-сервер (server/webStandardStreamableHttp.js:248-251) на второй GET в той же сессии отвечает `409 Conflict: Only one SSE stream is allowed per session`. Выше по стеку 409 никто не обрабатывает: SPEC-005 (src/rules/spec.ts:117-123) пропускает только 200 SSE, 405, 401 и 400 без sessionId, поэтому выдаёт warning. В test/ эталонного SDK-сервера с сессиями нет: фикстура test/fixtures/http-bridge.ts самописная, и одновременные GET-стримы она не ограничивает, так что тест намеренности такого поведения не показывает. spec.md это не оправдывает: для корректного сервера с сессиями результат — ложное срабатывание. Severity понижаю до medium: это неверный результат в массовом реальном случае (ложный warning SPEC-005), но не утечка и не поломка основного сценария, все остальные проверки отрабатывают.
- *repro*: confirmed (conf 0.93) — Воспроизведено на loopback. Поднят эталонный SDK-сервер (StreamableHTTPServerTransport с sessionIdGenerator, один tool), против него запущены dist/connect.js buildSnapshot и dist/rules/engine.js runRules(RULES). Цепочка, как и описано в находке. SDK-клиент после `notifications/initialized` сам открывает standalone GET SSE (sdk client/streamableHttp.js:386-390). Затем wire.ts:56-62 шлёт второй GET с тем же `mcp-session-id`. Сервер отвечает 409 «Only one SSE stream is allowed per session» (sdk server/webStandardStreamableHttp.js:250-251). SPEC-005 (src/rules/spec.ts:117-123) принимает только 200 SSE, 405 и 400 без sessionId, поэтому на 409 выдаёт warning. В итоге корректный сервер на SDK с сессиями, самый массовый случай, получает ложное SPEC-005. Severity понижаю с high до medium: это неверный результат (ложный warning) в реальных случаях. Основной сценарий не ломается, утечки секретов и проблемы безопасности нет.

### F019 [medium/bug] Same-host редирект (trailing slash) ломает все сырые пробы: ложные SPEC-005/SPEC-007, пропуск SRV-008, неверная era

**Where.** `src/probe/network.ts:107` (reviewer: protocol-probe)

**What.** Сырые пробы (preflight в src/probe/network.ts:107, discover, GET, version-пробы, origin-пробы) идут через tracer.request с redirect:'manual' (src/protocol/trace.ts:233) по URL как введён. SDK-клиент при этом следует same-host редиректу (trace.ts:206, fetch без redirect:'manual') и подключается. Если сервер отвечает 308 /mcp → /mcp/, правила считают 3xx ответом сервера. Получаются ложные SPEC-005 ("GET returned 308") и SPEC-007 ("1900-01-01 was answered with 308"), а SRV-008 (сервер принимает чужой Origin) пропадает. По тем же причинам discover получает 308, поэтому dual-сервер будет помечен как legacy. Это следует из кода и вживую не проверено. Ниже по стеку случай нигде не обрабатывается. В src/rules нет фильтра 3xx, кроме SRV-006, в connect.ts нет finalUrl. SRV-006 правильно предупреждает «register the final URL», так что пользователь узнаёт о редиректе. Поэтому severity medium, а не high: основной сценарий не ломается, но часть находок неверна (шум и пропуски).

**Evidence.** Живой репро: сервер 308 `/mcp`→`/mcp/` + SDK-сервер за ним. Для `http://127.0.0.1:PORT/mcp`: `preflight 308 discover 308 get 308 badVersion 308 originEvil 308 originNone 308`; findings: `SPEC-005 warning GET returned 308; expected 200 text/event-stream or 405`, `SPEC-007 warning MCP-Protocol-Version: 1900-01-01 was answered with 308, expected 400`, при этом `SRV-008 … accepts a foreign Origin (DNS rebinding risk)`, который выдавался для `/mcp/`, пропал. В exchanges видно, что SDK дублирует каждый вызов: `sdk initialize:308, sdk initialize:200, …`.

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f019/srv.mjs: node:http, 308 /mcp → /mcp/, на /mcp/ stateless SDK McpServer (StreamableHTTPServerTransport), GET → 405. Запуск: node dist/cli.js http://127.0.0.1:PORT/mcp --format json и тот же запуск для /mcp/.
/mcp → era legacy, findings: SPEC-005 warning "GET returned 308; expected 200 text/event-stream or 405"; SPEC-007 warning "MCP-Protocol-Version: 1900-01-01 was answered with 308, expected 400"; SRV-006 warning (GET и POST, "register the final URL"); SRV-008 отсутствует.
/mcp/ → SRV-008 error "local server ... accepts a foreign Origin (DNS rebinding risk)"; SPEC-005 и SPEC-007 отсутствуют; SRV-017 warning trailing slash.
Сырой вывод: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f019/out-mcpx.json и /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f019/out-mcp/x.json (из-за `/` в имени второй файл, вероятно, не записался в scratchpad; вывод выше взят из консоли).
```

**Suggested fix.** После preflight: если 301/302/307/308 и Location same-host — один раз зафиксировать `finalUrl` и выполнять discover/wire/auth пробы по нему (сохранив SRV-006 по исходному preflight). При cross-host редиректе — не следовать, но явно пометить пробы как «не выполнены из-за редиректа» (needs/skip), чтобы SPEC-005/007 не срабатывали на 3xx. Минимум: в rules игнорировать статусы 3xx для проб.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Строка 107 актуальна: preflight → requestRetried → tracer.request, а там fetch с redirect:'manual' (trace.ts:233). В buildHttp (src/connect.ts) редирект после preflight не разбирается. discover, wire-пробы и originProbes отправляются по исходному url. discOk = status===200, так что при 308 era не может стать dual или modern. Правила: SPEC-005 (spec.ts:119-123) отсекает только 401 и sse, на 308 выдаёт warning. SPEC-007 (spec.ts:165) срабатывает на любой статус кроме 400. SRV-008 требует 2xx от originEvil. Спека (docs/design/spec.md:161-165) описывает same-host редирект только для SRV-006 (warning «register the final URL»). Она не говорит, что остальные пробы должны срабатывать на 3xx, так что такое поведение не задумано. Тестов, закрепляющих это поведение, нет: в test/rules/server.test.ts есть только юнит для SRV-006, в e2e — только cross-host редирект. Живой repro подтвердил утверждение. Часть про era (dual → legacy) вживую не проверена: тестовый SDK-сервер legacy и всё равно определяется как legacy. Вывод о dual сделан по коду (discOk требует 200). Severity понижена до medium: SRV-006 явно предупреждает о редиректе и советует зарегистрировать финальный URL. Ошибка даёт неверные или пропущенные находки, но не ломает подключение и не раскрывает секреты.
- *repro*: confirmed (conf 0.88) — Проблему воспроизвёл на живом локальном стенде (127.0.0.1, свой лаб). Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/srv308.mjs поднимает http-сервер: на /mcp он отвечает 308 Location: /mcp/, а на /mcp/ работает SDK McpServer со StreamableHTTPServerTransport без сессий. Затем прогнал dist/cli.js по http://127.0.0.1:18731/mcp и по /mcp/. Результат совпадает с evidence автора: все сырые пробы получают 308, а SDK-вызовы задваиваются (308, затем 200). Для /mcp появляются ложные SPEC-005 и SPEC-007, а SRV-008 (error, DNS rebinding на loopback), который выдаётся для /mcp/, пропадает. Причина в коде: preflight/originProbes вызывают requestRetried с исходным url, trace.ts:233 делает fetch с redirect:'manual', а правила SPEC-005/007 и SRV-008 не отличают ответы 3xx. Severity снизил до medium, потому что SRV-006 всё равно предупреждает о редиректе и советует зарегистрировать финальный URL, ложные находки имеют уровень spec warning, а секреты не утекают. Утверждения про era и про пропуск auth-пробы проверены только по коду (connect.ts:286), не воспроизведены.

### F020 [medium/bug] Незакавыченный URL в WWW-Authenticate порождает фантомный challenge и обрезанный resource_metadata

**Where.** `src/rules/util/wwwAuth.ts:38` (reviewer: protocol-probe)

**What.** parseWwwAuthenticate (src/rules/util/wwwAuth.ts:55) читает незакавыченное значение auth-param через readToken(), а token по RFC 9110 не может содержать ':' и '/'. Поэтому для `Bearer resource_metadata=https://host/...` получается resource_metadata='https', а остаток строки разбирается как фантомный challenge `{scheme:'host', token68:'/...'}`. Выше по стеку это нигде не исправляется. src/probe/auth.ts:76 передаёт 'https' в prmCandidates: `new URL('https')` бросает исключение, оно молча проглатывается, и PRM по ссылке из заголовка не запрашивается. Остаются только well-known fallback'и. Если PRM лежит по нестандартному пути, инструмент сообщает, что PRM не найден, и дальше сыплются ложные AUTH-находки. Правило в src/rules/auth.ts:94 выдаёт error с вводящим в заблуждение текстом «resource_metadata https is not an absolute https URL». Настоящий SDK-клиент (extractFieldFromWwwAuth в @modelcontextprotocol/sdk, регэксп `resource_metadata=(?:"([^"]+)"|([^\s,]+))`) принимает незакавыченное значение целиком, так что поведение линтера расходится с поведением реального клиента. Нарушение RFC со стороны сервера стоит репортить отдельной корректной находкой, а не обрезанным URL. Второй случай, `Bearer realm=` → token68 'realm=', тоже воспроизводится, но это редкий край без заметных последствий.

**Evidence.** node против dist: `parseWwwAuthenticate('Bearer resource_metadata=https://api.example.com/.well-known/oauth-protected-resource')` → `[{"scheme":"bearer","params":{"resource_metadata":"https"}},{"scheme":"api.example.com","params":{},"token68":"/.well-known/oauth-protected-resource"}]`; `parseWwwAuthenticate('Bearer realm=')` → `[{"scheme":"bearer","params":{},"token68":"realm="}]`.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f020.mjs (import из dist/rules/util/wwwAuth.js):
Bearer resource_metadata=https://api.example.com/.well-known/oauth-protected-resource => [{"scheme":"bearer","params":{"resource_metadata":"https"}},{"scheme":"api.example.com","params":{},"token68":"/.well-known/oauth-protected-resource"}]
Bearer realm= => [{"scheme":"bearer","params":{},"token68":"realm="}]
Контроль (закавыченные значения в порядке): Bearer resource_metadata="https://a/x", error="invalid_token" => [{"scheme":"bearer","params":{"resource_metadata":"https://a/x","error":"invalid_token"}}]
Для сравнения: node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js:476 — `new RegExp(`${fieldName}=(?:"([^"]+)"|([^\\s,]+))`)`, SDK принимает незакавыченный URL целиком.
```

**Suggested fix.** В ветке auth-params при незакавыченном значении читать до следующей `,` или конца строки (lenient-режим) и помечать challenge флагом `malformed: true`, чтобы AUTH-правило могло выдать отдельную находку «resource_metadata must be a quoted-string». Для `name=` с пустым значением возвращать `params[name] = ''`, а не token68. Добавить тесты в test/util.test.ts.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Номер строки актуален: строка 38 (isParam) и строка 55 (readToken для незакавыченного значения) соответствуют описанию. Воспроизвёл против dist, результат совпадает с evidence автора. Проверил, нет ли защиты выше или ниже по стеку. probe/auth.ts:67-76 использует parsed напрямую, prmCandidates глотает невалидный URL (catch {}), а rules/auth.ts:93-94 показывает обрезанное 'https'. В test/util.test.ts и test/rules/auth.test.ts есть только закавыченные варианты; теста, который фиксировал бы обрезку как намеренную, нет. spec.md:93 говорит лишь «RFC 9110 parser with quoted strings support» и утверждению не противоречит. Главный довод за то, что это баг, а не допустимая строгость: SDK-клиент MCP принимает незакавыченное значение целиком, то есть реальные клиенты пройдут discovery, а линтер сообщит ложное отсутствие PRM и неверный URL. Оставил severity medium: в реальных серверах это встречается, результат неверный, но это не секреты и не основной сценарий для корректных серверов.
- *repro*: confirmed (conf 0.85) — Воспроизвёл через node против dist/rules/util/wwwAuth.js. Поведение совпадает с evidence автора полностью, в том числе со случаем 'Bearer realm='. Корректно закавыченный URL разбирается правильно. Медленно разобрал, что из этого следует. RFC 9110 требует, чтобы auth-param value был token или quoted-string, а URL с ':' и '/' не является token. Значит, сервер с таким заголовком действительно не соответствует спецификации, и для строгих клиентов ссылка resource_metadata не работает. Линтер в итоге всё равно выдаёт ошибку AUTH-003, то есть вердикт верный. Неверны текст сообщения («https is not an absolute https URL» вместо «value must be quoted»), фантомный challenge в parsed и молчаливый пропуск кандидата из заголовка в prmCandidates. Это неточная диагностика в редком крае, а не неверный результат. Поэтому дефект подтверждаю с severity low, а не medium.

### F021 [medium/bug] SRV-010 latency: timings[method] пополняется всеми пробами (origin, badVersion, invalid-token, редирект-хопы)

**Where.** `src/protocol/trace.ts:189` (reviewer: protocol-probe)

**What.** В src/protocol/trace.ts:189-190 `finishHeaders` добавляет `ex.durationMs` в `timings[requestJson.method]` для каждого exchange с JSON-RPC телом. Метка (label) и статус ответа при этом не проверяются. Функцию вызывают и sdkFetch, и `tracer.request` (пробы), а фильтра нет ни выше, ни ниже по стеку: connect.ts:371/655 копирует `tracer.timings` в `snap.transport.timings` как есть. Поэтому в выборку, по которой SRV-010 (src/rules/server.ts:257-264) считает медиану и ищет вызовы дольше 5 с, попадают пробы: preflight, origin (none/claude.ai/…) и `auth invalid-token` (все с методом initialize), badVersion и headerMismatch (none/wrong) (tools/list), badVersion (modern) (server/discover), resourceMissing (modern) (resources/read), а также 3xx-хопы. В docs/design/spec.md:195 сказано: «timings of initialize (or server/discover), tools/list, and UI resources/read», то есть имеются в виду реальные вызовы handshake и listing. Ни один тест не закрепляет такое поведение как намеренное: test/rules/server.test.ts подставляет timings вручную. Последствия: быстрые ответы-ошибки на пробы (400/403) уводят медиану вниз, и медленный реальный handshake (>500 мс) не даёт info-находку. Обратный случай: проба, зависшая до таймаута, даёт ложный warning «slow calls over 5 s» под именем initialize или tools/list.

**Evidence.** Репро с mock fetch: `tracer.request('badVersion', …, body tools/list)` и `tracer.request('origin evil', …, body initialize)` → `timings: {"tools/list":[1.2],"initialize":[0.19]}`. Живой репро против SDK-сервера: `initialize: 7` сэмплов (preflight + 4 origin + 2 sdk), при редиректе `initialize: 9, tools/list: 7`. Код: trace.ts:189-190 `const method = (ex.requestJson…).method; if (typeof method === 'string') (timings[method] ??= []).push(ex.durationMs)`.

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f021.mjs: mock fetch, реальный SDK-вызов initialize отвечает за 900 мс, 5 проб (preflight, origin ×3, auth invalid-token) с телом initialize отвечают за 5 мс статусом 400. Вывод: {"initialize":[900,5,5,5,5,5]}. Медиана 5 мс, поэтому SRV-010 молчит, хотя реальный handshake занял 900 мс (> 500 мс).
```

**Suggested fix.** Писать timings только для exchanges с label `sdk *`/`modern *` и статусом 2xx (или передавать флаг `measure: true` из ModernClient/sdkFetch), а пробы (`preflight`, `origin*`, `badVersion`, `headerMismatch*`, `auth *`) исключить. Для 3xx-хопов не писать.

**Verifier votes.**

- *reader*: confirmed (conf 0.88) — Утверждение подтверждается, номер строки актуален: trace.ts:189-190. В finishHeaders нет фильтра ни по label, ни по статусу, и вызывают её и sdkFetch (стр. 207), и request (стр. 234), через который идут все пробы. По grep пробы с телами initialize/tools/list/server/discover/resources/read такие: network.ts originProbes и preflight, auth.ts:120 invalid-token, wire.ts:46-50 и 65 через modern.request, который вызывает tracer.request. В connect.ts timings копируются без фильтрации. SRV-010 берёт все сэмплы по ключам initialize/server/discover/tools/list/resources/read. Спецификация говорит о латентности реальных вызовов handshake и listing, так что поведение расходится с замыслом. В test/ нет теста, который делал бы такое поведение намеренным. Severity medium: результат правила неверен на реальных серверах (каждый HTTP-прогон добавляет пробы). Тяжелее не ставлю, потому что само правило уровня info, а warning >5 с ложно срабатывает только на медленных пробах.
- *repro*: confirmed (conf 0.9) — Находка подтверждена: и по коду, и мини-скриптом на dist/*.js.

**Что в коде.** В `src/protocol/trace.ts:189-190` функция `finishHeaders` кладёт `ex.durationMs` в `timings[requestJson.method]`. Это происходит для любого exchange, у которого JSON-тело содержит `method`. Функцию вызывают оба пути: и `sdkFetch`, и `request`, через который идут все сырые пробы. Метки и типы `sdk`/`probe` никак не фильтруются. Какие пробы попадают в выборку:
- `preflight` (`src/probe/network.ts`): тело `initializeBody()`.
- 4 origin-пробы: `initialize` или `server/discover`.
- `auth invalid-token` (`src/probe/auth.ts:120`): тело `initialize`.
- `badVersion` (`src/probe/wire.ts:65`): `tools/list`.
- `headerMismatch*` и `modern *`: идут через `ModernClient`, который вызывает `tracer.request`.
- Повторные попытки (retry) в `requestWithRetry` тоже записываются.

В `request` стоит `redirect: 'manual'`, поэтому для проб 3xx-хоп пишется как отдельный сэмпл.

**Как это ломает SRV-010.** Правило (`src/rules/server.ts:257-262`) берёт медиану по ключам `initialize`, `server/discover`, `tools/list` и `resources/read`. Если пробы быстро получают ошибку 4xx, они составляют большинство выборки и тянут медиану вниз. В итоге медленный сервер не получает info-находку «median > 500 ms».

**Почему medium, а не high.** Правило имеет уровень info только для chatgpt. Предупреждение «slow calls over 5 s» не теряется, потому что SDK-сэмплы в выборке остаются. Но в реальных случаях, когда сервер отклоняет запросы без авторизации, с чужим Origin или с неверной версией, результат правила неверен (ложноотрицательный). Поэтому medium.

**Чего не проверял.** Утверждение автора про «двойную запись при same-host редиректе для SDK» я не воспроизводил. Для SDK-пути (`fetch` с redirect follow по умолчанию) `finishHeaders` вызывается один раз на вызов. Двойная запись возможна только если редирект вручную обрабатывает сам SDK или код в `connect.ts`. Поэтому эту часть оцениваю как непроверенную, основной вывод она не меняет.

### F023 [medium/bug] wrongTypeValue для union-/нетипизированных схем даёт валидное значение → ложное RT-002

**Where.** `src/probe/active.ts:45` (reviewer: protocol-probe)

**What.** `wrongTypeValue` (active.ts:45-48) выбирает «неверное» значение только по `type[0]`, а при неизвестном типе всегда подставляет строку. Поэтому для union-схем (`['string','number']` дает 12345, `['number','string']` дает строку), для схем без `type` (`{}`, `anyOf`/`oneOf` с вариантом string, `$ref`) и для отсутствующей схемы свойства подставленное значение остаётся допустимым по схеме. Корректный сервер отвечает успехом, и RT-002 выдаёт ложное предупреждение «wrong-type argument returned a success result».

**Evidence.** active.ts:46-47: `const type = isObj(schema) ? (Array.isArray(schema.type) ? schema.type[0] : schema.type) : 'string'; return type === 'string' ? 12345 : 'mcp-review-check-wrong-type';` — для `{type:['string','number']}` → 12345 (number допустим); для `{}` → 12345 (any допустим).

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f023.mjs (импортирует dist/probe/active.js):
{"type":["string","number"]} -> 12345            (допустимо: number)
{} -> "mcp-review-check-wrong-type"              (допустимо: any)
undefined -> 12345                               (схемы нет, допустимо)
{"anyOf":[{"type":"string"},{"type":"number"}]} -> "mcp-review-check-wrong-type" (допустимо)
{"$ref":"#/defs/x"} -> "mcp-review-check-wrong-type" (тип не определён)
{"type":["number","string"]} -> "mcp-review-check-wrong-type" (допустимо: string)
{"type":"number"} -> "mcp-review-check-wrong-type" (корректно: недопустимо)
```

**Suggested fix.** Пропускать `invalid-type` для свойств без однозначного `type` (union, any, $ref, anyOf/oneOf) или выбирать тип, не входящий в union (object/array/boolean). Пометить в ActiveCall `skippedReason` и покрыть тестом.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Номер строки верный: `wrongTypeValue` находится в src/probe/active.ts:45-48. Функция смотрит только на `schema.type` (берёт первый элемент массива) и не учитывает остальные члены union, а также `anyOf`/`oneOf`/`$ref` и случай, когда схемы нет вообще. runActive (строка 90) подставляет это значение в первое обязательное свойство, помечает вызов как kind='invalid-type', и RT-002 (src/rules/runtime.ts:61) срабатывает на любой успешный ответ. Ни выше, ни ниже по стеку нет проверки, что подставленное значение действительно нарушает схему. В test/rules/runtime.test.ts:168 проверен только случай `{type:'string'}`. Union и схемы без типа тестами не покрыты, так что намеренного поведения не видно. spec.md:980/988 требует подставлять значение «неверного типа», и подстановка допустимого значения этому требованию противоречит. Одна неточность в evidence автора: для `{}` функция возвращает строку, а не 12345. Вывод от этого не меняется, потому что схеме без ограничений подходит любое значение. Severity medium оставляю: правило выдаёт ложное предупреждение на корректных серверах, у которых в первом обязательном параметре стоит union или any (например, z.union или z.any в zod), а это встречается на практике.
- *repro*: confirmed (conf 0.9) — Воспроизведено против dist/probe/active.js и dist/rules/runtime.js. Для схем union, any, anyOf и $ref функция wrongTypeValue выдаёт значение, которое схема допускает. Полный прогон runActive с fake-клиентом, который валидирует `string|number` и на настоящий неверный тип отвечает isError, всё равно приводит к срабатыванию RT-002. То же самое происходит для свойства без `type`. Union-типы для id (`string|number`) и нетипизированные свойства встречаются в реальных MCP-серверах. Поэтому результат неверен в реальных случаях: это ложноположительный warning, ядро сценария он не ломает, отсюда medium.

### F038 [medium/bug] AUTH-020: страница логина, содержащая строку redirect_uri, считается отказом в redirect_uri (claude error)

**Where.** `src/rules/auth.ts:508` (reviewer: rules-server-spec-auth)

**What.** AUTH-020 (src/rules/auth.ts:508) выдаёт ошибку claude=error «/authorize rejected redirect_uri …» для любого ответа /authorize, в первых 4 KB тела которого встречается строка «redirect_uri», включая ответ 200 со страницей логина или согласия, где redirect_uri лежит в hidden-input. Проверка login page (стр. 509) до такого ответа не доходит. Это расходится с spec §2.8: error положен только при 400 или теле ошибки, а для login page — info «verify manually». В итоге с --active-auth корректный AS получает ложный вердикт BLOCKED.

**Evidence.** Мини-репро на dist: bodySnippet = `<form ...><input type="hidden" name="redirect_uri" value="https://claude.ai/api/mcp/auth_callback">...` при status 200 -> `error [claude] /authorize rejected redirect_uri https://claude.ai/api/mcp/auth_callback (200)`. Код: `if (ex.status === 400 || /redirect_uri/i.test(body)) return [{ message: ... }]` стоит перед `if (ex.status === 200 && /<form|login|sign in/i.test(body))`.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f038.mjs  (AUTH_020.check из dist/rules/auth.js; exchange status=200, bodySnippet='<html>...<h1>Sign in</h1><form ...><input type="hidden" name="redirect_uri" value="https://claude.ai/api/mcp/auth_callback">...')
Вывод: [{"message":"/authorize rejected redirect_uri https://claude.ai/api/mcp/auth_callback (200)"}]. Поля severity нет, поэтому применяется значение правила по умолчанию claude=error. Ожидалось: info «/authorize shows a login page before validating …; verify manually».
```

**Suggested fix.** Сначала распознавать login-page (200 + `<form|login|sign in`) -> info «verify manually». Отказ считать только при 400, при JSON/параметре `error=invalid_request|invalid_redirect_uri|unauthorized_client` в теле или в `Location` 302-редиректа, либо при тексте вида /invalid[ _-]?redirect[ _-]?uri|redirect_uri (is|not) (invalid|allowed|registered)/i. Добавить тест с login-page, содержащей redirect_uri.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Строка 508 в src/rules/auth.ts актуальна: `if (ex.status === 400 || /redirect_uri/i.test(body))` стоит раньше проверки login page (стр. 509) и срабатывает при любом статусе, включая 200. Тело ответа — bodySnippet размером до 4 KB (src/protocol/trace.ts, SNIPPET=4096), поэтому hidden-input или JS-конфиг с redirect_uri, если он попал в первые 4 KB, захватывается. src/probe/auth.ts:170-183 подставляет redirect_uri в URL /authorize, а AS часто возвращает его на login- или consent-странице, например в формах согласия демо-провайдеров MCP. Выше по стеку этот случай не обрабатывается: finding без severity получает правило по умолчанию claude=error. Спецификация (docs/design/spec.md §2.8, AUTH-020) требует error только при «A 400, or an error body mentioning redirect_uri», а login-page до валидации должна давать info («verify manually»). Значит, код противоречит spec: он не отличает тело ошибки от обычной страницы. В test/rules/auth.test.ts есть только позитивный кейс (400 + 'invalid redirect_uri') и негативный (302 без тела). Теста, который закреплял бы текущее поведение для 200 login-page с redirect_uri, нет, так что поведение не задумано намеренно. Severity снижена до medium. Проверка работает только в opt-in режиме --active-auth и требует, чтобы redirect_uri оказался в первых 4 KB страницы. Многие AS (Auth0, Okta) сначала отвечают 302 на /u/login, а такой ответ правило пропускает. Тем не менее в реальных случаях это ложная error и вердикт BLOCKED.
- *repro*: confirmed (conf 0.9) — Код подтверждает находку. В AUTH_020 (src/rules/auth.ts:505-510) regex `/redirect_uri/i` по bodySnippet стоит в одном OR с проверкой status===400. Эта проверка выполняется раньше проверки login-page, а status при ней не учитывается. Находка в этой ветке создаётся без поля severity, поэтому срабатывает уровень правила по умолчанию: claude 'error'. bodySnippet — первые 4 KB тела после маскировки (src/protocol/trace.ts:194). fetch идёт с redirect:'manual', поэтому при 200 правило видит тело самой страницы логина. Проба /authorize (src/probe/auth.ts:171-182) запускается только с --active-auth. Репродукция на dist/rules/auth.js (AUTH_020.check) это подтвердила: страница 200 с `<input type=hidden name=redirect_uri>` даёт ошибку, а та же страница без этой строки — info. Severity снижена до medium: режим opt-in, и срабатывание зависит от содержимого страницы. Утечки секретов и поломки основного сценария без флага нет.

### F041 [medium/bug] SPEC-011: при era='modern' через discSignal (400/-3202x) `discoverRaw` не задан — сообщение «result is not an object» вводит в заблуждение

**Where.** `src/rules/spec.ts:252` (reviewer: rules-server-spec-auth)

**What.** SPEC-011 (src/rules/spec.ts:251-252) срабатывает, когда era='modern' выставлена через discSignal (connect.ts:293,307-309: server/discover вернул HTTP 400 с -32020/-32021/-32022), а snap.discoverRaw не задан. Тогда правило выдаёт ошибку [spec] «server/discover result is not an object», хотя сервер отклонил запрос, и не показывает статус, код и data.supported. При -32022 это ложноположительный результат. Исправление: при discoverRaw === undefined читать probeRpc(snap,'discover') и сообщать статус и код (или отдавать info/inconclusive). Сообщение «not an object» оставить только для ответа 200 с телом, которое не является объектом.

**Evidence.** Репро: era='modern', discoverRaw=undefined -> `error [spec] server/discover result is not an object`. Код: `const r = snap.discoverRaw; if (!isObj(r)) return [{ message: 'server/discover result is not an object' }];` без учёта `probeExchange(snap,'discover')`.

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f041.mjs: emptySnapshot() из dist/snapshot.js; s.era='modern'; s.transport.probes.discover = {status:400, json:{error:{code:-32022, message:'unsupported version', data:{supported:['2026-12-01']}}}}; discoverRaw не задан; вызов SPEC_011.check(s). Вывод: [{"message":"server/discover result is not an object"}]
```

**Suggested fix.** Если `discoverRaw === undefined`, взять `probeRpc(snap,'discover')` и сообщить `server/discover answered HTTP ${status} / code ${code}: ${message}` (для -32022 — «server does not support 2026-07-28 as sent; data.supported=...»), либо вернуть inconclusive info. Ветка «not an object» — только когда status 200 и тело не объект.

**Verifier votes.**

- *reader*: confirmed (conf 0.8) — Подтверждаю. Строка актуальна: src/rules/spec.ts:252 — `if (!isObj(r)) return [{ message: 'server/discover result is not an object' }];`. В src/connect.ts:293-294 `snap.discoverRaw` заполняется только при status 200 и наличии result, а в строках 307-309 эра становится 'modern' и по `discSignal`, то есть при ответе 400 с кодом из MODERN_CODES (-32020/-32021/-32022). Тогда `discoverRaw` остаётся undefined. Ни выше, ни ниже по стеку этот случай не обрабатывается. Условие `needs: ['modern']` в engine.ts проверяет только `MODERN_ERAS.has(snap.era)`, наличие discoverRaw оно не проверяет, поэтому правило запускается. В test/rules/spec.test.ts:55 есть только pos (пустой supportedVersions) и neg (валидный discoverRaw), случая discSignal без результата нет, так что намеренным такое поведение считать нельзя. docs/design/spec.md:329-330 описывает Detect для SPEC-011 только по полям результата (supportedVersions, capabilities, instructions), ветки «result is not an object» без результата там нет. Значит, утверждение спеке не противоречит, а текущее поведение выходит за неё. Последствие: если сервер отвечает на наш discover ошибкой -32022 (не поддерживает версию, которую мы отправили) или -32020 (несовпадение заголовков), пользователь получает ошибку [spec] «result is not an object» без HTTP-статуса и кода. При -32022 это по сути ложноположительный результат: сервер повёл себя по спеке. Severity medium сохраняю: в реальном сценарии (modern-only сервер, отвергающий нашу версию) получается неверный результат, но основной сценарий не ломается и секреты не утекают.
- *repro*: confirmed (conf 0.8) — Проблему воспроизвёл против dist. Код подтверждает: discSignal даёт era='modern' без discoverRaw (connect.ts:293-309). Правило с needs:['modern'] запускается, потому что MODERN_ERAS включает 'modern'. При !isObj(undefined) правило отдаёт фиксированное сообщение и не учитывает snap.transport.probes.discover. Никакое другое правило код ошибки discover не показывает. Severity снизил до low: сценарий узкий. Нужен сервер только с 2026-07-28 (legacy initialize не прошёл), который при этом отверг наш server/discover одним из трёх кодов. Основной сценарий это не ломает, но в этом случае получается вводящий в заблуждение finding уровня error, а для -32020/-32021 он фактически ложный.

### F062 [medium/bug] TOOL-017: $schema с «другой» схемой URL (https draft-07 / http 2020-12) принимается регуляркой, но Ajv его не знает — ложный error «does not compile»

**Where.** `src/rules/schema.ts:27` (reviewer: rules-tools-schema)

**What.** TOOL-017: DIALECTS принимает http и https для draft-07, 2019-09 и 2020-12, но `$schema` передаётся в Ajv без нормализации. Ajv регистрирует мета-схемы только под каноническими id (http для draft-07, https для 2019-09 и 2020-12). Поэтому для https://json-schema.org/draft-07/schema#, http://json-schema.org/draft/2020-12/schema и http://json-schema.org/draft/2019-09/schema validateSchema бросает «no schema with key or ref», и правило выдаёт ложный spec error «inputSchema does not compile» для валидной схемы. Тот же дефект в validateAgainst (RT-006) приводит к тому, что валидация молча пропускается. Исправление: подставлять в копию канонический `$schema` диалекта (или удалять его) перед validateSchema/compile; добавить тесты на неканонические варианты.

**Evidence.** node против dist: inputSchema {$schema:'https://json-schema.org/draft-07/schema#', type:'object'} -> [{"path":"inputSchema","message":"inputSchema does not compile: no schema with key or ref \"https://json-schema.org/draft-07/schema#\""}]; то же для 'http://json-schema.org/draft/2020-12/schema'. С каноническими http/https-вариантами — [].

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f062.mjs вызывает TOOL_017.check({tools:[{name:'t',inputSchema:{$schema:ID,type:'object'}}]}) из dist/rules/schema.js:
https://json-schema.org/draft-07/schema# -> [{"tool":"t","path":"inputSchema","message":"inputSchema does not compile: no schema with key or ref \"https://json-schema.org/draft-07/schema#\""}]
http://json-schema.org/draft-07/schema# -> []
http://json-schema.org/draft/2020-12/schema -> [{...,"message":"inputSchema does not compile: no schema with key or ref \"http://json-schema.org/draft/2020-12/schema\""}]
https://json-schema.org/draft/2020-12/schema -> []
http://json-schema.org/draft/2019-09/schema -> [{...,"message":"inputSchema does not compile: no schema with key or ref \"http://json-schema.org/draft/2019-09/schema\""}]
```

**Suggested fix.** В ajvFor/TOOL-017 нормализовать `$schema` к каноническому URI диалекта перед validateSchema (например, хранить в DIALECTS canonical id и подставлять `copy.$schema = canonical`), либо удалять `$schema` из копии и полагаться на выбор инстанса по диалекту. Добавить тест на https-draft-07.

**Verifier votes.**

- *reader*: confirmed (conf 0.93) — Подтверждено воспроизведением против dist/rules/schema.js. Регулярки DIALECTS (src/rules/schema.ts:27-29, строка актуальна) принимают и http, и https для всех трёх диалектов, то есть автор намеренно хотел поддержать обе схемы URL. При этом в TOOL-017 `$schema` удаляется из копии только для unknownDialect (строки 118-121). Распознанный, но неканонический URI уходит в ajv.validateSchema(copy), а Ajv знает мета-схему только по каноническому id: draft-07 по http, 2019-09 и 2020-12 по https. Ajv бросает «no schema with key or ref». У этого исключения нет missingRef, и под /can't resolve reference/ оно не попадает, поэтому catch (строки 130-133) выдаёт его как spec error «does not compile».

Выше по стеку ничего не нормализует `$schema`: в ajvFor есть только выбор инстанса. Тест test/rules/tools.test.ts:244 покрывает лишь канонический http draft-07, тестов на неканонические варианты нет. docs/design/spec.md (TOOL-017) требует проверять схему по мета-схеме её диалекта, а для неизвестного диалекта выдавать warning, так что error для валидной схемы противоречит spec.

Та же причина затрагивает validateAgainst (RT-006, строки 63-71): compile бросает исключение, функция молча возвращает undefined, и валидация structuredContent для таких схем пропускается.

Severity оставляю medium. Это ложная находка уровня error (spec), она влияет на итоговый результат и exit code. Входы редкие, но код явно задуман их принимать. Если считать неканонические URI редким краем, допустимо понизить до low.
- *repro*: confirmed (conf 0.95) — Подтверждено фактическим запуском против dist/rules/schema.js. В коде регулярки DIALECTS (строки 27-29) содержат https?://. При совпадении ajvFor не возвращает unknownDialect, поэтому `delete copy.$schema` не выполняется, и Ajv получает URI, которого нет в его реестре мета-схем. Для канонических вариантов (http для draft-07, https для 2019-09/2020-12) правило молчит, что подтверждает именно эту причину. Дополнительно: validateAgainst (RT-006) с теми же URI возвращает undefined вместо ошибки валидации, то есть runtime-проверка тихо отключается. Severity medium: TOOL-017 даёт ложный error уровня spec на валидные схемы в реальных, хотя и не самых частых случаях. Большинство генераторов (zod-to-json-schema) пишут канонический http-draft-07, но варианты с https встречаются. Основной сценарий не ломается, утечки секретов нет.

### F063 [medium/bug] TOOL-023: method-параметр через $ref не разворачивается — пропуск ошибки «mixing safe and unsafe methods»

**Where.** `src/rules/tools.ts:233` (reviewer: rules-tools-schema)

**What.** walkSchema сначала посещает узел-ссылку `{ $ref }` и только потом его цель. TOOL-023 (src/rules/tools.ts:233) берёт первый подходящий узел, то есть ссылку без enum. Поэтому enum методов, вынесенный в $defs, не распознаётся: вместо error «mixing safe and unsafe methods» выдаётся warning «free-form method parameter», а если имя инструмента не совпадает с HTTP_TOOL_NAME, не выдаётся ничего. TOOL-025 (строка 296) тоже проверяет параметры без deref и считает $ref-параметр с enum в цели свободной строкой. Правило TOOL-026 я не воспроизводил.

**Evidence.** node против dist: api_request с method:{$ref:'#/$defs/M'}, $defs.M.enum=['GET','POST','DELETE'] -> [{"severity":"warning","message":"generic HTTP tool with a free-form method parameter"}]; с inline enum -> error «method parameter allows both safe and unsafe HTTP methods (GET, POST, DELETE)». TOOL-025: call_api с endpoint:{$ref:'#/$defs/E'} (enum в цели) -> «generic executor with free-form "endpoint" parameter».

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f063.mjs, запуск против dist/rules/tools.js. Схема: properties.method={$ref:'#/$defs/M'}, $defs.M={type:'string',enum:['GET','POST','DELETE']}.
ref TOOL_023 [{"tool":"api_request","severity":"warning","path":"/properties/method","message":"generic HTTP tool with a free-form method parameter"}]
ref TOOL_025 [{"tool":"call_api","severity":"warning","message":"generic executor with free-form \"method\" parameter"}]
inline TOOL_023 [{"tool":"api_request","path":"/properties/method","message":"method parameter allows both safe and unsafe HTTP methods (GET, POST, DELETE)"}]
inline TOOL_025 [{"tool":"call_api","severity":"warning","message":"generic executor with free-form \"url\" parameter"}]
```

**Suggested fix.** Разворачивать узел через `deref(t.inputSchema, v.node)` перед enumValues/isFreeString/isFreeObject в TOOL-023/025/026/015, либо в walkSchema предпочитать посещение цели $ref с viaProperty и пропускать голый узел-ссылку (как уже делается через `path.endsWith('/$ref')` в TOOL-009/021).

**Verifier votes.**

- *reader*: confirmed (conf 0.9) — Утверждение подтверждено. В src/rules/tools.ts:233 TOOL-023 запоминает первый узел, у которого viaProperty=true и подходящее имя. walkSchema (src/rules/util/schemaWalk.ts:54-84) сначала передаёт в visit сам узел-ссылку `{ $ref }` и только потом его цель (path …/$ref, с тем же rawName и viaProperty). Поэтому methodProp указывает на голую ссылку: enumValues возвращает undefined, а isFreeString возвращает true, потому что type, enum, pattern и format отсутствуют. В итоге вместо claude error выдаётся warning, а если имя инструмента не совпадает с HTTP_TOOL_NAME, не выдаётся ничего. В TOOL-025 (строка 296) properties() просматривается без deref, и $ref-параметр тоже считается свободной строкой. Ни выше, ни ниже по стеку это не исправляется: deref используется только в строках 190 и 439. В test/rules/tools.test.ts нет тестов с $ref, так что намеренным такое поведение не выглядит. spec.md:520 требует error для явных enum HTTP-методов, и уровень вложенности схемы этого требования не отменяет. Номер строки 233 актуален. Severity medium: в реальных схемах (pydantic, zod-to-json-schema с $defs) результат неверный, но затронут только частный случай.
- *repro*: confirmed (conf 0.93) — Проблема воспроизводится против dist/rules/tools.js. walkSchema (src/rules/util/schemaWalk.ts) сначала вызывает visit для самого узла `{ $ref }` с viaProperty=true и тем же rawName, и только потом спускается в цель ссылки по пути `${path}/$ref`. В TOOL-023 (src/rules/tools.ts:233) условие `if (!methodProp && ...)` поэтому захватывает голый узел-ссылку. Для него enumValues() возвращает undefined, а isFreeString() даёт true (type отсутствует, enum/pattern/format нет). В итоге вместо claude-error «mixing safe and unsafe methods» правило выдаёт warning «free-form method», а если имя инструмента не совпадает с HTTP_TOOL_NAME, не выдаёт ничего. TOOL-025 берёт свойства через properties() без deref, и isFreeString на `$ref`-узле тоже даёт true, отсюда ложное срабатывание «generic executor». Поведение TOOL-026 я не прогонял, но там тот же isFreeString, так что дефект почти наверняка общий. Severity medium: результат неверен в реальных случаях. Pydantic/FastMCP выносят Enum-поля в `$defs` и ссылаются на них через `$ref`, так что это типичная форма схемы. Получаем пропуск claude-error (false negative) и ложный warning в TOOL-025. Секреты не утекают, основной сценарий работы не ломается. Исправление из находки корректно: в TOOL-023/025/026 разворачивать узел через `deref(t.inputSchema, node)` перед enumValues/isFreeString/isFreeObject, либо в TOOL-023 пропускать узел, у которого есть строковый `$ref`, и брать посещение `.../$ref`.

### F064 [medium/bug] TOOL-004: слова «top», «preferred», «official», «leading» как токены имени дают ложные «promotional» warning на обычных доменных именах

**Where.** `src/rules/tools.ts:72` (reviewer: rules-tools-schema)

**What.** TOOL-004 (src/rules/tools.ts:72, PROMO set; проверка в строках 81-84) срабатывает на любой токен имени или title из множества {top, preferred, official, leading, ...}, без учёта контекста. Поэтому обычные доменные имена вроде get_top_stories, top_headlines, set_preferred_language, get_official_rate и title «Top tracks» получают chatgpt-warning «promotional word», и он попадает в вердикт. Код точно повторяет docs/design/spec.md:403-406: там эти слова перечислены явно, так что это дефект самой спецификации и словаря эвристики, а не отклонение реализации от неё. Исправлять нужно спеку и код вместе. Варианты: убрать многозначные слова или требовать для них рекламный контекст (top_rated, best_*, «the official/leading ...» в title), либо понизить такие совпадения до info. Ещё нужно добавить негативные кейсы в test/rules/tools.test.ts: сейчас там один негатив, list_recommendations.

**Evidence.** node против dist: name 'get_top_stories' -> [{"message":"promotional word \"top\" in name or title"}]; 'set_preferred_language' -> «promotional word "preferred"»; title 'Top tracks' -> «promotional word "top"».

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f064.mjs вызывает dist/rules/tools.js TOOL_004.check напрямую:
get_top_stories [{"tool":"get_top_stories","message":"promotional word \"top\" in name or title"}]
set_preferred_language [{"tool":"set_preferred_language","message":"promotional word \"preferred\" in name or title"}]
get_official_rate [{"tool":"get_official_rate","message":"promotional word \"official\" in name or title"}]
list_tracks (title 'Top tracks') [{"tool":"list_tracks","message":"promotional word \"top\" in name or title"}]
top_headlines [{"tool":"top_headlines","message":"promotional word \"top\" in name or title"}]
```

**Suggested fix.** Для многозначных слов (top, preferred, official, leading) требовать контекст: позицию перед другим «рекламным» словом, сравнительную форму (`top_rated`, `best_*`), или учитывать только title/description в сочетании с name; либо сделать их отдельным info-уровнем. Добавить негативные кейсы get_top_stories / set_preferred_language в test/rules/tools.test.ts.

**Verifier votes.**

- *reader*: confirmed (conf 0.7) — Номер строки актуален: в строке 72 файла src/rules/tools.ts определено множество PROMO. TOOL_004 разбивает на токены name и title, склеивает соседние токены и выдаёт находку, если любой токен входит в PROMO. Выше по стеку контекст не проверяется и исключений нет. В test/rules/tools.test.ts:19 есть только позитив best_search и негатив list_recommendations, так что намеренность ложных срабатываний на get_top_stories и похожих именах тест не подтверждает. В spec.md:403-406 правило задано ровно так: любой токен из списка, куда входят top, preferred, official и leading. Значит, реализация спеке соответствует, и уточнённое описание переносит дефект на уровень спеки. Но утверждение о том, что на распространённых нерекламных именах получается неверный результат, подтверждено воспроизведением. Это chatgpt-warning, он влияет на вердикт, отсюда medium. Альтернатива — low, потому что это сознательно заданная эвристика уровня warning.
- *repro*: confirmed (conf 0.85) — Находка подтверждена. В src/rules/tools.ts:72 множество PROMO содержит 'top', 'official', 'preferred' и 'leading'. TOOL-004 разбивает на токены имя и title инструмента и выдаёт warning, если любой одиночный токен есть в PROMO. Контекст при этом не учитывается: нет проверки, что слово стоит в позиции самовосхваления (best_*, top_rated, «official X app»). Поэтому обычные предметные имена (get_top_stories, set_preferred_language, get_official_rate, list_leading_indicators, title «Top tracks») получают chatgpt-warning, и он влияет на итоговую оценку (verdict) для ChatGPT (src/report/text.ts:150-152 учитывает warnings). В test/rules/tools.test.ts:19 есть только позитивный кейс best_search и негативный list_recommendations, негативных кейсов для многозначных слов нет. Severity medium: правило даёт неверный результат на распространённых реальных именах, хотя это лишь warning, а не error.

### F065 [medium/bug] TOOL-026: параметр `body`/`payload` трактуется как raw-request — ложное срабатывание на create_issue/post_message/send_email

**Where.** `src/rules/tools.ts:309` (reviewer: rules-tools-schema)

**What.** В TOOL-026 (src/rules/tools.ts:309, 340) имена `body`/`payload`/`request_body` из RAW_QUERY срабатывают безусловно: в отличие от RAW_TARGET, им не нужен соседний method/url. Поэтому любой write-инструмент с текстовым полем `body`/`payload` (create_issue, send_email, post_message) получает claude-warning «free-form "body" parameter but the description does not name or link the target API», если в описании нет URL, «X API» или названия продукта. Это происходит не только при общем serverInfo.name: при 'github-mcp' предупреждение тоже выдаётся, если в описании инструмента нет слова github. Регекс в spec.md:544 включает body/payload, но это расходится с заявленным там же замыслом (проверять raw-request и языки запросов, а не текст на естественном языке). Поэтому исправить нужно и код, и спеку: считать body/payload/request_body raw-параметрами только рядом с method/url/endpoint/headers (как RAW_TARGET) либо когда тип — свободный object. Безусловными оставить только языки запросов.

**Evidence.** node против dist: create_issue с properties {repo,title,body}, description 'Create a new issue in the given repository with a title and body.', serverInfo.name='mcp-server' -> [{"path":"/properties/body","message":"free-form \"body\" parameter but the description does not name or link the target API"}].

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f065.mjs (TOOL_026.check из dist/rules/tools.js):
create_issue mcp-server [{"tool":"create_issue","path":"/properties/body","message":"free-form \"body\" parameter but the description does not name or link the target API"}]
send_email mcp-server [{"tool":"send_email","path":"/properties/body",...}]
post_message mcp-server [{"tool":"post_message","path":"/properties/payload",...}]
create_issue github-mcp [{"tool":"create_issue","path":"/properties/body",...}]   (описание 'Create a new issue in the given repository.')
```

**Suggested fix.** Считать `body`/`payload`/`request_body` raw-параметрами только рядом с method/url/endpoint/headers (как RAW_TARGET), либо только если тип object/free string и описание параметра содержит `request|json|raw|http`; оставить безусловными только языки запросов (sql, graphql, jql...).

**Verifier votes.**

- *reader*: confirmed (conf 0.75) — Строка актуальна: src/rules/tools.ts:309 `const RAW_QUERY = /^(endpoint|query_?string|body|request_?body|payload|graphql|...)$/i`. В TOOL-026 (строки 335-347) имена из RAW_QUERY срабатывают безусловно, без всякого контекста. Контекст method (`hasMethod`) требуется только для RAW_TARGET (path/url/uri/route). isFreeString (стр. 217) считает свободной любую строку без enum/pattern/format, поэтому обычный текстовый `body` подходит. Выше по стеку ничего не фильтрует: perTool просто обходит все tools. Тесты в test/rules/tools.test.ts (TOOL-026, стр. 96-99 и 279-287) покрывают только sql, query, path и method+url. Ни одного кейса, где `body`/`payload` у write-инструмента должен срабатывать намеренно, там нет. Формально spec.md:543-544 перечисляет `body|request_?body|payload` в регексе, так что код соответствует букве спеки. Но та же строка спеки задаёт замысел: «raw request or query-language parameter… A natural-language `query`… is not checked». Название правила тоже говорит о «Free-form query tool». Текст issue или письма — это естественный язык, а не тело HTTP-запроса. Значит, срабатывание расходится с замыслом спеки, и спеку тоже стоит уточнить. Repro через dist подтверждает ложные срабатывания. Масштаб шире, чем пишет автор: правило срабатывает и при брендовом serverInfo.name='github-mcp', если в описании инструмента нет слова github. Последствие — ложный claude-warning на типичных write-инструментах. Это неверный результат в реальных случаях, т.е. medium.
- *repro*: confirmed (conf 0.9) — Прочитал F065.json и код TOOL-026 в src/rules/tools.ts (строки 307–347). RAW_QUERY = /^(endpoint|query_?string|body|request_?body|payload|graphql|...)$/i проверяется без условия. Подавить срабатывание может только URL или «X API» в описании либо productNames(serverInfo), найденный в name/title/description. Комментарий над регэкспом прямо говорит, что natural-language параметры не считаются raw, но `body` с текстом сообщения под это исключение не попадает. Воспроизвёл через dist/rules/tools.js, вызывая TOOL_026.check(snapshot) напрямую. Все четыре типичных write-инструмента (create_issue, post_message, send_email, add_comment), где body — строка с текстом, дают warning. Тот же результат при serverInfo.name='github-mcp', если описание не упоминает github. В test/rules/tools.test.ts на этот случай нет негативного теста: проверяются только sql, query и path. Ложный warning появляется на очень частом реальном паттерне, но основной сценарий от этого не ломается, и это не утечка секретов. Поэтому severity medium (неверный результат в реальных случаях).

### F082 [medium/bug] POL-002: regex MEDIA без завершающего \b — create_article, clipboard, voicemail считаются генерацией медиа

**Where.** `src/rules/policy.ts:29` (reviewer: rules-injection-data-policy-apps)

**What.** В POL-002 регулярное выражение MEDIA (src/rules/policy.ts:29) не закрыто границей слова после группы медиа-существительных. Из-за этого префиксы art/clip/voice совпадают внутри обычных слов: create_article, make_artifact_list, edit_voicemail_greeting, edit_clipboard. Такие инструменты получают claude=warning «AI media generation». Пример copy_to_clipboard из исходной находки ложно не срабатывает: нужен глагол из списка непосредственно перед «clip». Исправление: добавить \b после группы существительных.

**Evidence.** node против dist: POL_002.check для tools create_article / copy_to_clipboard / edit_voicemail_greeting вернул 3 находки: "tool: AI media generation: \"create article create_article Create a new knowledge-base article.\"" и т.д.

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f082.mjs вызывает POL_002.check на dist/rules/policy.js с инструментами create_article, copy_to_clipboard, edit_voicemail_greeting, make_artifact_list. Вывод: 3 находки, по одной на create_article, edit_voicemail_greeting и make_artifact_list. Пример сообщения: "tool: AI media generation: \"create article create_article Create a new knowledge-base article.\"". На copy_to_clipboard находки нет.
```

**Suggested fix.** Добавить `\b` (или `(?![a-z])`) после группы медиа-существительных: `...|podcast)\b/i`; аналогично для `tts` в MEDIA2.

**Verifier votes.**

- *reader*: confirmed (conf 0.9) — Строка 29 файла src/rules/policy.ts актуальна. Регулярное выражение MEDIA = /(generate|create|...|edit)[_ -]?(an? )?(ai )?(image|...|art|...|clip|...|voice|...)/i не закрыто \b ни после группы существительных, ни перед глаголом. Поэтому «create art» совпадает внутри «create article», «edit voice» внутри «edit voicemail», «make art» внутри «make artifact». В POL_002 нет фильтрации выше по стеку: при любом совпадении MEDIA.exec выдаётся находка claude=warning. До info её понижает только DESIGN, а он на такие тексты не срабатывает. В test/rules/content.test.ts нет негативного кейса, который закреплял бы такое поведение как намеренное: единственный neg там get_image_metadata. Правило задумано как эвристика ИИ-генерации медиа, ложные срабатывания на CRUD противоречат этому замыслу. Одна оговорка: пример автора copy_to_clipboard НЕ воспроизводится, потому что перед «clip» нет глагола из списка. «clip»+«board» срабатывает только в сочетании с глаголом, например edit_clipboard. Severity medium оправдана: create_article и edit_* часто встречаются в реальных серверах, и все они получают ложный warning.
- *repro*: confirmed (conf 0.93) — Нашёл причину в коде. Регулярное выражение MEDIA = /(generate|create|...|edit)[_ -]?(an? )?(ai )?(image|...|art|...|clip|...|voice|...|sound|podcast)/i не заканчивается на \b, поэтому совпадает с началом более длинного слова. Затем запустил POL_002.check на dist/rules/policy.js и получил реальные находки для create_article, edit_clipboard, edit_voicemail_greeting, make_artifact и create_soundboard. copy_to_clipboard не сработал: в утверждении этот пример ошибочен, но на суть дефекта это не влияет. Severity оставляю medium: правило выдаёт ложный warning для Claude на распространённых инструментах (статьи, артефакты, буфер обмена, голосовая почта) и искажает отчёт. На безопасность это не влияет, секреты не утекают.

### F083 [medium/bug] POL-001: MONEY_NAME матчится как подстрока сырого имени — bestsellers/stakeholders/send_email

**Where.** `src/rules/policy.ts:23` (reviewer: rules-injection-data-policy-apps)

**What.** Правило POL-001 (src/rules/policy.ts:23) проверяет MONEY_NAME по сырому имени инструмента без границ слов, поэтому глаголы находятся внутри других слов: sell в get_bestsellers, stake в list_stakeholders, а также pay в payload, wire в wireframe, stake в mistake, bridge в cambridge. Затем достаточно любого из широкого набора MONEY_WORDS в описании (stock, shares, bank), чтобы выдать warning «money or asset transfer». Отдельная, более слабая проблема — send_email с упоминанием «bank holiday»: send там самостоятельный токен, и переход на токены этот случай не исправит. Для него нужно требовать денежный объект в имени или рядом с глаголом (как в suggested_fix). Исправление: сопоставлять имя по tokenize(name) с набором глаголов (составные place_order/execute_trade проверять по соседним токенам), а для общих глаголов send/pay/buy/sell требовать денежный токен в имени.

**Evidence.** POL_001.check: get_bestsellers ('...currently in stock'), list_stakeholders ('...their shares of the budget'), send_email ('...mention the bank holiday') → 3 находки 'looks like a money or asset transfer'.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f083.mjs (import { POL_001 } from dist/rules/policy.js; POL_001.check({tools:[get_bestsellers 'List bestselling products currently in stock.', list_stakeholders '...their shares of the budget.', send_email '...mention the bank holiday...']}))
Вывод: 3 находки — [{tool:'get_bestsellers',message:'looks like a money or asset transfer; ...'},{tool:'list_stakeholders',...},{tool:'send_email',...}]
```

**Suggested fix.** Сопоставлять по токенам имени: `tokenize(name).some(t => MONEY_VERBS.has(t))` (есть `tokenize` в util/text.ts) вместо подстрочного regex; для `send`/`pay` требовать денежный объект в том же токен-окне.

**Verifier votes.**

- *reader*: confirmed (conf 0.88) — Строка 23 в src/rules/policy.ts актуальна: `if (annotations(t).readOnlyHint === true || !MONEY_NAME.test(name)) return [];`. MONEY_NAME (строка 11) — regex без границ слов и без опоры на токены, проверяется по сырому имени. Поэтому `sell` совпадает внутри `bestsellers`, а `stake` внутри `stakeholders`. Вторая проверка MONEY_WORDS (строка 12) смотрит описание целиком, и слова stock/shares/bank там встречаются часто. Ни выше, ни ниже по стеку это ничем не отфильтровано: правило — чистая функция, движок её вывод не фильтрует. В test/rules/content.test.ts для POL-001 есть только pos `transfer_funds` и neg `get_balance` / `send_payment_preview`(readOnly), так что тестов, закрепляющих подстрочное совпадение как намеренное поведение, нет. В docs/RULES.md правило помечено «(heuristic)», но ложные срабатывания на bestsellers/stakeholders — это следствие отсутствия границ слов, а не замысел эвристики. Код уже вызывает `tokenize(name)` при сборке text, значит токенизация предполагалась. Repro против dist подтверждает все три находки. Одна оговорка: случай `send_email` — не подстрочная ошибка. `send` там отдельный токен, и предложенная замена на токены этот случай не уберёт; срабатывание идёт из-за того, что денежного объекта в имени нет, а `bank` из описания («bank holiday») засчитывается. Суть утверждения верна. Severity medium: правило уровня warning, но оно даёт неверный результат на реальных каталожных и CRM-инструментах (ещё примеры: payload, wireframe, mistake, cambridge).
- *repro*: confirmed (conf 0.9) — Подтверждено. В src/rules/policy.ts:23 правило POL-001 вызывает `MONEY_NAME.test(name)` на сыром имени инструмента. У regex на строке 11 нет ни якорей, ни границ токенов, поэтому `sell` находится внутри `bestsellers`, `stake` внутри `stakeholders`, а `send` в `send_email`. Вторая проверка MONEY_WORDS (строка 25) срабатывает на обычных словах из описания вроде `stock`, `shares`, `bank`. В итоге правило выдаёт warning «money or asset transfer» на инструменты каталога, CRM и почты. Воспроизвёл через dist/rules/policy.js: все три ложных срабатывания из failure_scenario подтвердились, контрольный `transfer_funds` тоже ожидаемо даёт находку. Правило помечено как heuristic и имеет уровень warning, а не error. Но ложные warning на типичных e-commerce и CRM серверах означают неверный результат в реальных случаях, поэтому оставляю medium. Те же подстроки дают риск и в других именах, например `buy` в `buyer`, `trade` в `trademark`, `bridge` в `bridge_status`. Предложенное исправление разумно: сравнивать по токенам через уже импортированный `tokenize`.

### F084 [medium/bug] extractOrigins: CSS-regex `url\(` с флагом i ловит JS `new URL("https://…")` как resource-origin с confidence tag

**Where.** `src/rules/util/html.ts:62` (reviewer: rules-injection-data-policy-apps)

**What.** У регулярки CSS url() в extractOrigins (html.ts:62) нет левой границы, и из-за флага `i` она ловит JS-вызовы `new URL("https://…")` / `URL("https://…")`. Такой origin получает kind=resource и confidence=tag. Поэтому APPS-007 сверяет его с resourceDomains, а не с connectDomains, и выдаёт ложный chatgpt=error: потолок warning для js-находок не срабатывает. Это расходится со spec.md:81, где источником resource назван только CSS `url()`.

**Evidence.** extractOrigins('<script>const u = new URL("https://api.example.com/v1"); fetch(u)</script>') → [{kind:'resource', origin:'https://api.example.com', evidence:'URL("https://api.example.com/v1")', confidence:'tag'}]; APPS_007 с csp.connectDomains=['https://api.example.com'] → 'resource origin https://api.example.com is not declared in the CSP'.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f084.mjs (import extractOrigins из dist/rules/util/html.js):
extractOrigins('<script>const u = new URL("https://api.example.com/v1"); fetch(u)</script>')
→ [{"kind":"resource","origin":"https://api.example.com","evidence":"URL(\"https://api.example.com/v1\")","confidence":"tag"}]
Дальше по коду apps.ts:167-171: csp.resource=[] → origin не найден → push с severity undefined → умолчание правила chatgpt=error (connectDomains не проверяются, потому что KIND_FIELD['resource']='resource').
```

**Suggested fix.** Запретить идентификатор перед `url(`: `/(?<![\w.$])url\(/gi` (или проверять, что совпадение внутри `<style>`/атрибута style), а `new URL(lit)` добавить в jsPatterns как `connect` с confidence js.

**Verifier votes.**

- *reader*: confirmed (conf 0.9) — Номер строки верный: src/rules/util/html.ts:62 содержит `/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi`. Перед `url(` нет ни границы слова, ни lookbehind, а флаг `i` ловит и `URL(`. Поэтому JS-выражение `new URL("https://api.example.com/v1")` разбирается как CSS `url()` и получает kind=resource, confidence=tag. Выше по стеку это ничем не исправляется. APPS_007 (src/rules/apps.ts:167-171) вызывает extractOrigins(r.html) напрямую, без stripComments и без отделения <style> от <script>, и ищет origin в csp['resource']. cspOf (src/rules/util/ui.ts:76) хранит connect и resource раздельно, поэтому домен, объявленный в connectDomains, совпадения не даёт. severity остаётся undefined, так как поднимается только при confidence==='js', и действует умолчание правила: chatgpt=error. Ни один тест в test/rules/apps.test.ts не проверяет это поведение. Тесты APPS-007 покрывают только `<script src>` и `fetch(...)`, где для js стоит потолок warning. docs/design/spec.md:81 прямо называет источником resource только «CSS `url()`»: срабатывание на JS `URL(` противоречит замыслу, а не задумано так. Repro на dist подтвердил описание автора. Severity medium подходит: `new URL("https://…")` часто встречается в коде виджетов, и в итоге получается ложный error для ChatGPT по правилу публикации в каталоге. Если домен не объявлен нигде, finding всё равно выдаётся, но с неверным kind (в сообщении «resource» вместо «connect») и с завышенной уверенностью: error вместо потолка warning.
- *repro*: confirmed (conf 0.95) — Находка воспроизвелась на собранном dist. В src/rules/util/html.ts:62 стоит регулярка для CSS `/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi`. У неё нет якоря слева, и она регистронезависима. Поэтому она находит подстроку `URL("https://...")` в JS-выражении `new URL("https://...")` в любом месте HTML, в том числе внутри <script>. Такой origin записывается как kind='resource' с confidence='tag'. APPS-007 (src/rules/apps.ts:154-175) сверяет его со списком csp.resource, а не csp.connect. Понижение до warning срабатывает только при confidence==='js', здесь оно не применяется. В итоге правило выдаёт severity=error (chatgpt error), хотя домен объявлен в connectDomains и реально используется для fetch. Для сравнения, `fetch("https://api.example.com/v1")` при том же CSP находок не даёт. С шаблонной строкой (`new URL(`...`)`) ложного срабатывания нет, потому что класс символов допускает только кавычки " и '. Паттерн `new URL("https://...")` с абсолютным литералом часто встречается в коде виджетов. Ложная ошибка APPS-007 на правильно настроенном CSP — это неверный результат в реальном сценарии, но не утечка и не поломка основного сценария, поэтому severity medium (совпадает с оценкой автора). Предложенное исправление разумное: отрицательный lookbehind `(?<![\w.$])url\(` или поиск только внутри <style>/style=, плюс отдельный js-паттерн для `new URL(lit)`. Однако `new URL()` сам по себе запроса не делает, поэтому относить его к connect тоже эвристика, и лучше давать confidence 'js'.

### F087 [medium/bug] DATA-001: `transcript` в STRONG_CONVO → error на инструментах транскрипции встреч/звонков

**Where.** `src/rules/data.ts:47` (reviewer: rules-injection-data-policy-apps)

**What.** src/rules/data.ts:47: в STRONG_CONVO есть голое имя `transcript`, поэтому DATA-001 выдаёт claude=error и chatgpt=error на любой параметр с таким именем. Под это попадают законные инструменты транскрипции встреч, звонков и видео (Zoom/Otter/Fireflies/YouTube), где пользователь сам передаёт текст транскрипта. Срабатывает и булев флаг `transcript` («включить транскрипт»): в отличие от WEAK_CONVO, у strong-имён нет проверки isNonText, нет понижения по описанию или типу. Итог: сервер получает BLOCKED на обеих платформах и ненулевой exit code. Код дословно повторяет docs/design/spec.md:655 (§2.5). Значит, это дефект дизайна, общий для спеки и кода, а не расхождение реализации со спекой. Он нарушает цель §1.2 «warning для word-list детекции, чтобы избежать ложных срабатываний» и логику, по которой спека уже убрала голое `memory` из strong. Исправление: перенести голое `transcript` в WEAK_CONVO (warning, с пропуском non-text типов), уровень error оставить для `chat_transcript` и `conversation_transcript`; поправить spec.md §2.5 и добавить тест в test/rules/content.test.ts рядом с guard'ами из строк 135–140.

**Evidence.** DATA_001.check для summarize_meeting с {transcript:{type:'string', description:'The meeting transcript text'}} → {path:'/properties/transcript', message:'parameter "transcript" requests conversation data'} (severity rule default = error).

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f087b.mjs (импортирует dist/rules/data.js и dist/snapshot.js). Инструменты: summarize_meeting{transcript:string "Meeting transcript text from Zoom"}, get_captions{transcript:boolean "Include transcript"}, a{chat_transcript:string}. DATA_001.check вернул все три находки с message 'parameter "transcript" requests conversation data' и без своего поля severity, значит, действует уровень правила по умолчанию: {claude:error, chatgpt:error}. Ложными срабатываниями здесь являются первые два, включая булев флаг.
```

**Suggested fix.** Перенести одиночный `transcript` в WEAK_CONVO (warning) либо оставлять error только для `chat_transcript`/`conversation_transcript`; дополнительно понижать до warning, если description параметра содержит meeting|call|video|audio|recording.

**Verifier votes.**

- *reader*: REFUTED (conf 0.75) — Код на src/rules/data.ts:47 (строка актуальна) дословно совпадает со спецификацией. В docs/design/spec.md §2.5 (строка 655) для DATA-001 список «Strong names» явно включает голый `transcript` с пометкой `→ error`. Weak-имена и текстовые эвристики при этом отдельно понижены до warning. Заголовок правила в spec, RULES.md и data.ts:64 звучит так: «Requests conversation history, transcripts, memory or system prompt», то есть transcripts относятся к области правила намеренно. В spec.md:1095 (C9) сказано, что «strong conversation-history property names» — детерминированные маркеры, которые по §1.2 остаются error. Получается, что срабатывание на `summarize_meeting.transcript` — задокументированное поведение по замыслу, а не дефект реализации. Находка по сути оспаривает проектное решение spec: ложные срабатывания на транскриптах встреч и видео правдоподобны, но это вопрос к спецификации, а не к коду. Для таких случаев есть обход через CLI `--ignore DATA-001` (src/cli.ts:52). Тестов в test/ со словом transcript нет, поэтому тест намеренность не подтверждает, но spec — достаточный источник. При сомнении по умолчанию refuted=true. Если пересматривать, то как изменение spec (перенести `transcript` в WEAK_CONVO), с severity low/medium.
- *repro*: confirmed (conf 0.65) — Воспроизведено на dist/rules/data.js. Для инструмента summarize_meeting с параметром {transcript:{type:'string', description:'The meeting transcript text'}} DATA_001.check возвращает находку с severity по умолчанию у правила, а это {claude:error, chatgpt:error}. Поведение заложено намеренно: spec.md §2.5 перечисляет `transcript` среди strong-имён с уровнем error, а название правила упоминает "transcripts". Но по §1.2 словарная (word-list) детекция должна давать warning. Голое `transcript` неоднозначно так же, как `memory`, которое спека сознательно понизила: инструменты транскрипции встреч и видео распространены и легитимны. Итог: ложный BLOCKED в реальных случаях, это medium. Уверенность понижена: формально код соответствует утверждённой спеке, и автор мог считать любой транскрипт рискованным по политике.
- *ARBITER (round 2)*: confirmed (conf 0.8) — Арбитраж по F087 закончен: находка подтверждается как дефект дизайна (спека и код вместе), severity medium.

Что я проверил сам:
- Прочитал src/rules/data.ts:45-80, docs/design/spec.md §1.2 (стр. 33-37), §2.5 (стр. 653-658) и C9 (стр. 1095), а также тесты test/rules/content.test.ts:128-140.
- Повторил репро на dist/rules/data.js. Параметр `transcript` у summarize_meeting даёт error/error. Error/error даёт и `transcript` с type:boolean: у strong-имён нет проверки isNonText, она есть только у weak-имён. Это ещё сильнее показывает ложное срабатывание.

Аргументы голоса refuted (reader, 0.75):
1. Код дословно совпадает со spec.md:655, где голый `transcript` стоит в strong-списке с уровнем error. Это верно.
2. В названии правила есть слово «transcripts». Верно.
3. C9 относит strong-имена к детерминированным маркерам. Верно.
4. Есть обход через `--ignore DATA-001`. Верно.

Эти доводы доказывают только одно: код соответствует спеке. Ложного срабатывания они не опровергают. Сама находка не утверждает, что код расходится со спекой. Она утверждает, что на распространённых законных инструментах правило блокирует сервер, и это воспроизводится.

Почему довод про «детерминированность» не спасает ситуацию:
- По §1.2 error ставится, только если детекция детерминирована. Любая детекция по словарю (word-list) прямо названа там heuristic, то есть warning, «чтобы избежать ложных срабатываний».
- Детерминированность здесь значит лишь, что совпадение по точному имени воспроизводимо. Семантической уверенности оно не даёт.
- Спека сама применяет критерий неоднозначности: голое `memory` убрано из strong-списка, потому что так называют и параметр размера VM. Голое `transcript` неоднозначно точно так же, а то и сильнее. Транскрипт встречи или видео пользователь передаёт сам, это не история чата хоста.
- Слово «transcripts» в названии правила по смыслу политики относится к транскрипту разговора с ассистентом. В том же strong-списке уже есть `chat_?transcript`.
- `--ignore DATA-001` отключает всё правило целиком, включая настоящие `conversation_history` и `system_prompt`. Поэтому это не нормальная мера против ложных срабатываний.

Голос confirmed (repro, 0.65):
- Репро корректное. Выводы про противоречие с §1.2 и аналогию с `memory` верные.
- Его оговорку «формально соответствует спеке» я учёл: исправлять нужно и спеку, и код.

Обоснование severity medium:
- Ошибка уровня error на обеих платформах ведёт к BLOCKED и ненулевому exit code в CI.
- Целевая аудитория широкая: инструменты для встреч, звонков и видео.
- Поскольку булев `transcript` тоже ловится, ложных срабатываний будет больше.
- Security-дефекта нет, и есть грубый обход через ignore. Поэтому выше medium не поднимаю.

Часть с предложенным исправлением тоже разумна: перенос в WEAK_CONVO даёт warning и автоматически пропуск non-text типов.

Оговорка: у меня нет первоисточника политики, где голое слово «transcript» использовалось бы в более широком смысле. Отсюда уверенность 0.8, а не выше.

### F088 [medium/bug] DATA-002: голое `memory` после read/access/retrieve → «Read the memory usage of the VM» = доступ к памяти Claude

**Where.** `src/rules/data.ts:93` (reviewer: rules-injection-data-policy-apps)

**What.** DATA-002 (src/rules/data.ts:95, а не 93): в regex префикс `(claude'?s )?` необязателен, поэтому любое «read/access/retrieve/search … memory» (RAM VM, GPU memory, memory statistics, сущности knowledge-graph memory) флагуется как warning «accesses host memory or chat history» для профиля claude. В DATA-001 голое memory сознательно исключено как источник false positive, а в DATA-002 такой защиты нет.

**Evidence.** DATA_002.check для get_stats 'Read the memory usage of the VM.' → 'tool.description accesses host memory or chat history: "Read the memory usage of the VM."'.

**Repro (verifier).**

```
node-скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f088.mjs вызывает DATA_002.check из dist/rules/data.js на snapshot {prompts:[],resources:[],resourceTemplates:[],tools:[{name:'get_stats',description:T}]}:
Read the memory usage of the VM. => [{"tool":"get_stats","message":"tool.description accesses host memory or chat history: \"Read the memory usage of the VM.\""}]
Retrieve memory statistics for the container. => [... accesses host memory or chat history ...]
Search memory entities in the knowledge graph. => [... accesses host memory or chat history ...]
Access GPU memory info. => [... accesses host memory or chat history ...]
```

**Suggested fix.** Требовать квалификатор для `memory`: `(claude'?s|assistant'?s|host'?s|model'?s) memory|memory of (the|this) (conversation|chat)`, остальные объекты (chat history, past conversations, project knowledge) оставить без префикса. Добавить negative lookahead `memory(?! (usage|limit|size|footprint))`.

**Verifier votes.**

- *reader*: confirmed (conf 0.9) — Утверждение подтверждено. Регулярка DATA_002 находится в src/rules/data.ts:95, а не на строке 93, как указано в находке: `/\b(read|access|retrieve|search|export|sync)\b[^.]{0,30}\b(claude'?s )?(memory|chat history|...)\b/i`. Префикс `claude'?s ` в ней необязателен, поэтому голое `memory` после глагола в пределах 30 символов срабатывает всегда. Выше по стеку такой случай ничем не отфильтрован: scanText (data.ts:36) просто вызывает re.exec над корпусом. Тест test/rules/content.test.ts:63-66 проверяет только позитивный случай «Read Claude's memory» и негативный «revision history». Теста, который делал бы срабатывание на RAM/VM намеренным, нет. Наоборот, для соседнего DATA-001 есть явные guard-тесты против «VM memory size» (content.test.ts:135), и в коде есть комментарий «Bare `memory` is not here: a VM or cache size parameter is called `memory` too». Значит, авторы считают голое memory ложноположительным, и для DATA-002 это поведение не задумано. Последствие: в профиле claude правило выдаёт warning на обычные инструменты мониторинга и инфраструктуры, а также на MCP-серверы knowledge-graph memory. Для линтера это неверный результат в реальных случаях, поэтому severity medium.
- *repro*: confirmed (conf 0.9) — Проверил запуском. Код правила совпадает с описанием в находке: группа `(claude'?s )?` опциональна, и `memory` в альтернативах стоит без всякого квалификатора. Скрипт на node против dist/rules/data.js и dist/rules/engine.js со снимком из одного инструмента показал warning DATA-002 на трёх безобидных описаниях: «Read the memory usage of the VM.», «Retrieve the memory limit of a container.» и «Search memory entities in the knowledge graph.». Контрольное описание «Read a note's revision history.» ничего не выдало. Правило выдаёт warning только для claude, а не error, но такие формулировки реально встречаются у серверов мониторинга и memory-серверов, поэтому результат неверен в реальных случаях. Отсюда severity medium. Предложенное исправление разумно: требовать квалификатор (claude's/assistant's/host's) или исключать `memory (usage|limit|size|footprint)`.

### F093 [medium/bug] INJ-007: паттерн `(use|call|invoke|ask) (the )?X (connector|plugin|app|integration)` ловит самоссылку «Use this app to …»

**Where.** `src/rules/injection.ts:254` (reviewer: rules-injection-data-policy-apps)

**What.** Паттерн 3 правила INJ-007 (src/rules/injection.ts:254) не помечен ownToolExempt, поэтому самоссылку «Use this app to …» он считает принуждением к стороннему софту. Это противоречит spec §INJ-007, где самоссылки (this/it/me/these) исключены для правила целиком. Ложная находка уровня warning появляется и в INJ-007 (описания), и в RT-011 (вывод инструментов).

**Evidence.** INJ_007.check для log_workout 'Use this app to track your workouts and meals.' → evidence 'Use this app'. RT_011 на выводе 'Tip: use this app to see more.' тоже срабатывает.

**Repro (verifier).**

```
node-скрипт против dist/rules/injection.js:
matchPattern(INJ_007_PATTERNS[2], 'Use this app to track your workouts and meals.') -> pattern 2 own false "Use this app"
matchPattern(INJ_007_PATTERNS[2], 'Tip: use this app to see more.') -> pattern 2 own false "use this app"
INJ_007.check({tools:[{name:'log_workout',description:'Use this app to track your workouts and meals.',inputSchema:{type:'object'}}],resources:[],prompts:[],resourceTemplates:[]})
-> [{"tool":"log_workout","message":"tool.description: \"Use this app to track your workouts and meals.\"","evidence":"Use this app"}]
Скрипты: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f093.mjs, /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f093b.mjs
```

**Suggested fix.** Поставить `ownToolExempt: true` на этот паттерн или добавить negative lookahead `(?!\s+(this|our|the) (app|plugin|connector|integration)\b)` после глагола.

**Verifier votes.**

- *reader*: confirmed (conf 0.9) — Строка 254 актуальна: третий паттерн INJ_007_PATTERNS `/\b(use|call|invoke|ask) (the )?[\w\- ]{1,30} (connector|plugin|app|integration)\b/i` не помечен ownToolExempt, поэтому ownToolFilter (стр. 279) сразу возвращает true, и самоссылка «this» не исключается. Выше по стеку это никак не обрабатывается: scanCorpus/INJ_007 и RT_011 (src/rules/runtime.ts:260) используют те же паттерны и тот же фильтр. В test/rules/content.test.ts нет теста, который закреплял бы срабатывание на «Use this app». Тесты на стр. 157–162 наоборот проверяют, что самоссылки и общие фразы не дают находок. Spec (docs/design/spec.md:626–633) описывает для INJ-007 общее правило: если каждая ссылка — собственный инструмент или самоссылка (this, it, me, these), находку не выдавать, и RT-011 использует те же паттерны и исключение. Код противоречит spec: исключение не работает для паттерна 3. Предложенный фикс (ownToolExempt: true) рабочий: referencedIdentifiers берёт слово после «use», то есть «this» из SELF_REFS, и находка снимается. «Use our app» при этом останется находкой, потому что «our» нет в SELF_REFS; это отдельный вопрос. Severity medium: это ложное предупреждение на типичной вводной фразе описаний ChatGPT-приложений в реальных серверах, а не утечка и не поломка основного сценария.
- *repro*: confirmed (conf 0.92) — Подтверждено воспроизведением против dist/rules/injection.js. Третий паттерн INJ_007_PATTERNS (src/rules/injection.ts:254) `\b(use|call|invoke|ask) (the )?[\w\- ]{1,30} (connector|plugin|app|integration)\b` не помечен ownToolExempt, поэтому ownToolFilter сразу пропускает его как находку (`if (!p.ownToolExempt) return true`). В итоге «Use this app to …» (то есть описание самого приложения) INJ-007 трактует как принуждение к стороннему софту. RT-011 (src/rules/runtime.ts:252) берёт тот же INJ_007_PATTERNS с тем же фильтром, так что текст вывода «Tip: use this app to see more.» тоже даст ложное срабатывание: это видно по коду, вживую не запускал, нужен active snapshot. Это ложный warning на типичной вводной фразе в описаниях ChatGPT-апп, а такие предупреждения шумят в отчётах для реальных серверов. Поэтому severity medium. Уточнение к предложенному исправлению: одного `ownToolExempt: true` хватает только для «this»/«these», потому что они есть в SELF_REFS. «Use our app» по-прежнему срабатывает: referencedIdentifiers вернёт «our», а его нет в SELF_REFS. Значит, нужно либо добавить «our» в SELF_REFS, либо поставить negative lookahead на (this|our|these) после глагола.

### F115 [medium/security] Терминальная инъекция: ANSI/OSC/CR из данных сервера печатаются в text-отчёт без экранирования

**Where.** `src/report/text.ts:97` (reviewer: report-redact-engine)

**What.** renderText (src/report/text.ts:97 и строки находок 52/56, fixSnippets 81, limitsNotice/coverage.reason 106-109) печатает строки, пришедшие от недоверенного сервера (serverInfo.name/title/version, имена tools/resources, сообщения правил), без экранирования C0/C1-контролов. connect.ts:139/148 копирует serverInfo как есть, serverName() (src/report/index.ts:72) возвращает его без обработки, cli.ts:375 пишет результат прямо в stdout. ESC/CR/BEL проходят в терминал, поэтому сервер может перекрасить или стереть строки и вставить поддельную строку вердикта или OSC 8-ссылку. Код выхода и JSON-отчёт это не затрагивает: подменяется только то, что человек видит в терминале. escapeHidden из src/rules/util/text.ts уже умеет экранировать \p{Cc}, но рендерер её не вызывает. INJ-001 по spec §INJ проверяет только \p{Cf} и диапазоны tag/bidi, так что ESC не флагуется.

**Evidence.** Репро против dist (serverInfo.name с ESC, tool.name с \x1b[2K\r):
["Server  Evil\u001b[32m PASS \u001b[0m\u001b]8;;https://attacker.test\u0007click\u001b]8;;\u0007 1 · https://mcp.example.test/mcp", ...]
ESC in text report: true CR in text report: true
ESC in markdown: true
INJ-001 findings: []  (ESC не распознан)
findings mentioning ESC raw: [ 'TOOL-001', 'TOOL-008', 'TOOL-005', 'TOOL-018' ]
Код: src/report/text.ts:97 `out.push(`Server  ${serverName(snap)} · ${targetLabel(snap)}`)`; src/rules/injection.ts:64-78 hiddenChars учитывает только \p{Cf}.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f115.mjs (serverName из dist/report/index.js с serverInfo.name='Evil\x1b[2K\rFAKE PASS') -> "Evil\u001b[2K\rFAKE PASS 1" true. Эта строка без изменений попадает в renderText (text.ts:97), а затем в process.stdout.write (cli.ts:375).
```

**Suggested fix.** Единая точка санитизации перед рендером (аналогично redactDeep): пройти все строки Report и заменить \p{Cc} (кроме \n, \t там, где они допустимы) через escapeHidden из src/rules/util/text.ts или вырезать. Для text-формата дополнительно схлопывать \r/\x1b/\x9b/\x07 в видимые \u{..}. Также расширить INJ-001 hiddenChars на C0/C1 (\p{Cc} кроме \t\n\r) как hard-маркер — это детерминированный признак инъекции.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Утверждение подтверждено. Строка 97 актуальна: там `out.push(`Server  ${serverName(snap)} · ${targetLabel(snap)}`)`. В src/ нет ни одной санитизации управляющих символов ни выше по стеку (connect.ts присваивает serverInfo как есть), ни в report/index.ts (serverName), ни в cli.ts (stdout.write). Единственный escapeHidden есть в src/rules/util/text.ts, но используется только для фрагментов в сообщениях INJ. В spec.md нет требования экранировать вывод и нет теста, который делал бы такое поведение намеренным; §5.1 про markdown требует экранировать только pipe. Severity снижаю до medium: подменяется только визуальный вывод в терминале, код выхода и json/sarif остаются верными, секреты не утекают. Это реальная security-проблема для инструмента, который по замыслу проверяет недоверенные серверы, но основной сценарий не ломает.
- *repro*: confirmed (conf 0.9) — Прочитал src/report/text.ts. renderText подставляет serverName(snap), f.tool/f.resource и toolName(t) в fixSnippets без санитизации. escapeHidden есть в src/rules/util/text.ts, но в отчётах не используется. В cli.ts путь такой: redactDeep(built, redactor), затем render(), затем stdout. redactDeep вырезает только секреты, управляющие символы не трогает. Воспроизвёл на dist: собрал Snapshot с ESC/OSC 8 в serverInfo.name и с "\x1b[2K\r" в имени tool, затем прогнал runRules, buildReport, redactDeep с настоящим redactorFor и renderText. В text-отчёт попали сырые ESC и CR, в markdown тоже, находок INJ-001 0. Утверждение автора подтверждается полностью. Severity снизил до medium. Это подмена или запутывание вывода в терминале (CWE-150) при проверке чужого сервера, но секреты не утекают и проверка сервера выполняется корректно. К тому же TOOL-001 всё-таки срабатывает на ESC в имени tool, хотя его строку тоже можно затереть.

### F116 [medium/security] Cookie-заголовок редактируется только целиком: отдельное значение cookie (session id), эхо-возвращённое сервером, утекает

**Where.** `src/redact.ts:55` (reviewer: report-redact-engine)

**What.** Значение заголовка Cookie (как из --header, так и из argv `--header 'Cookie: ...'`) попадает в Redactor только целиком, плюс его JSON- и percent-encoded формы. Отдельные пары name=value и сами значения cookie в список секретов не добавляются. Если сервер вернёт в теле или ошибке только идентификатор сессии или одну пару `session=X`, `scrub` его не заменит, и он утечёт в bodySnippet и json отчёта. Это нарушает docs/design/spec.md:1355.

**Evidence.** node repro: buildRedactor({headers:{Cookie:'theme=dark; session=S3cr3tSess10nValue'}}).values =>
[ 'theme%3Ddark%3B%20session%3DS3cr3tSess10nValue', 'theme=dark; session=S3cr3tSess10nValue' ]
scrub('server echoed session S3cr3tSess10nValue in error') => 'server echoed session S3cr3tSess10nValue in error' (не отредактировано)

**Repro (verifier).**

```
node -e "import('./dist/redact.js').then(m=>{const r=m.buildRedactor({headers:{Cookie:'theme=dark; session=S3cr3tSess10nValue'}});console.log([...r.values]);console.log(m.scrub('echo session=S3cr3tSess10nValue / S3cr3tSess10nValue',r))})"
=> [ 'theme%3Ddark%3B%20session%3DS3cr3tSess10nValue', 'theme=dark; session=S3cr3tSess10nValue' ]
=> echo session=S3cr3tSess10nValue / S3cr3tSess10nValue   (не отредактировано)
Для argv ['npx','mcp-remote','--header','Cookie: theme=dark; session=S3cr3tSess10nValue'] получаются те же два значения.
```

**Suggested fix.** В headerSecrets для имени cookie разбивать значение по `;` и добавлять каждое `name=value` и отдельно `value` (≥4 символов, не TRIVIAL). Аналогично для Basic: декодировать base64 и добавлять user:pass и pass отдельно (см. следующий пункт).

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Утверждение подтверждено. В src/redact.ts:55 `headerSecrets` для Cookie вызывает `withSchemeToken`. Та выделяет отдельно только токен после схемы (bearer/basic/token/dpop), а значение Cookie по `;` и `=` никто не разбивает. В `buildRedactor` (стр. 103) в список секретов попадает только строка заголовка целиком. `createRedactor` в src/protocol/trace.ts:20-28 добавляет к ней лишь JSON-экранированную и percent-encoded формы. Ниже по стеку случай тоже не обрабатывается: `redactHeaders` маскирует заголовок Cookie по имени, но только в записях трассы. Текст, который прислал сервер (тело, ошибка, bodySnippet, json), проходит через `scrub` и сравнивается с полной строкой. Теста в test/, который закрепил бы такое поведение как намеренное, нет. Это поведение расходится с docs/design/spec.md:1355: там сказано, что значения Cookie заменяются на «redacted» во всех форматах. Строка 55 в файле актуальна. Тот же пробел есть и в argv (`mcp-remote --header 'Cookie: ...'`). Severity medium, а не high: утечка случится, только если сервер вернёт отдельное значение cookie или пару name=value без остальной строки, например в сообщении об ошибке «invalid session X». Полная строка Cookie при этом редактируется.
- *repro*: confirmed (conf 0.88) — Находка воспроизведена на dist/redact.js. В src/redact.ts:55 headerSecrets → withSchemeToken отделяет только токен после схемы (Bearer/Basic/Token/DPoP). Для Cookie в Redactor попадает лишь вся строка, а createRedactor (src/protocol/trace.ts:23) добавляет к ней JSON-escaped и percent-encoded формы. Отдельные пары name=value и сами значения cookie туда не попадают. Поэтому scrub/redactDeep не заменяют значение session cookie, если сервер вернул его отдельно или вместе с другим набором cookie. Даже единственный cookie 'session=X' редактируется только как вся строка 'session=X', а X сам по себе — нет. createRedactor маскирует заголовок cookie по имени (headerNames), но это касается только записанных заголовков, а не тела или текста ошибки. Утечка возможна лишь при условии, что сервер вернёт значение cookie в теле или ошибке. Поэтому severity medium, а не high. Через argvSecrets ('Cookie: ...' в stdio argv) путь тот же, что подтверждает чтение кода.

### F119 [medium/bug] Секреты длиной 4–5 символов заменяются внутри слов (sk-test → sk-«redacted», attestation → at«redacted»ation)

**Where.** `src/protocol/trace.ts:23` (reviewer: report-redact-engine)

**What.** createRedactor (src/protocol/trace.ts:23, строка актуальна) пропускает секреты от 4 символов, а scrub (стр. 30–34) заменяет их как подстроки, без учёта границ слова. Слова из TRIVIAL (redact.ts:13) отсекаются, но обычные короткие значения вроде test, demo, pass, dev1 проходят. Это не только косметика отчёта. Значения --header и --bearer входят в «сильный» уровень, и buildSnapshot (connect.ts:541, redactDeep) маскирует их в данных сервера ещё до правил: в именах инструментов, описаниях и схемах. В итоге с `--header 'X-Api-Key: test'` инструмент run_tests превращается в `run_«redacted»s`. Правило TOOL-001 даёт ложную находку «name contains "«" "»"», а в отчёте искажаются имена и описания (latest → la«redacted»). Вторичный эффект: секрет, который является подстрокой маркера («redact», «edact»), портит уже вставленный маркер (««redacted»ed»). Утечки не происходит, секрет всё равно маскируется. Спека (§4.5) требует маскировать значения --header, но не требует делать это внутри слов. Тестов, которые закрепляли бы замену внутри слов, нет.

**Evidence.** node repro: scrub('sk-test-abc, test account, attestation', buildRedactor({headers:{'X-Api-Key':'test'}})) => 'sk-«redacted»-abc, «redacted» account, at«redacted»ation'
scrub('token=ABCDEFGHIJKLMNOP1 redact', createRedactor([], ['ABCDEFGHIJKLMNOP1','redact'])) => 'token=««redacted»ed» «redacted»'

**Repro (verifier).**

```
node --input-type=module -e "const m=await import('./dist/redact.js');const R=await import('./dist/rules/tools.js');const snap={tools:[{name:'run_tests',description:'Runs latest test suite',inputSchema:{type:'object'}}]};const s=m.redactDeep(snap,m.buildRedactor({headers:{'X-Api-Key':'test'}}));console.log(JSON.stringify(s.tools));console.log(JSON.stringify(R.TOOL_001.check(s)))"
=> [{"name":"run_«redacted»s","description":"Runs la«redacted» «redacted» suite",...}]
=> [{"tool":"run_«redacted»s","message":"name contains \"«\" \"»\""}]
Also: scrub('sk-test-abc, test account, attestation', buildRedactor({headers:{'X-Api-Key':'test'}})) => 'sk-«redacted»-abc, «redacted» account, at«redacted»ation'; scrub('token=ABCDEFGHIJKLMNOP1 redact', createRedactor([], ['ABCDEFGHIJKLMNOP1','redact'])) => 'token=««redacted»ed» «redacted»'
```

**Suggested fix.** Для коротких значений (<8) применять замену с границами (не внутри [A-Za-z0-9]) или поднять минимум до 6–8 для плейн-слов, оставив 4 только для значений с цифрами и буквами. Исключить из values строки, являющиеся подстрокой REDACTED.

**Verifier votes.**

- *reader*: confirmed (conf 0.8) — Строка 23 актуальна. Маскирование внутри слов не обрабатывается ни выше, ни ниже по стеку. TRIVIAL в buildRedactor исключает только слова протокола и схем, а test, demo и pass проходят. Важно, что rules работают на уже замаскированном snapshot: в cli.ts opts.redactor — это сильный уровень, connect.ts:541 вызывает redactDeep(result.snap, ...), и значения --header попадают именно в сильный уровень. Поэтому дело не только в виде отчёта: появляются ложные находки (TOOL-001), а имена инструментов и описания искажаются. В test/redaction-tiers.test.ts проверяется, что слово в --env под обычным именем не меняет находки, но для коротких значений --header или --bearer такой гарантии нет. Тест e2e-redaction про «короткое значение» (Zq1 в query) относится к маскированию в URL и не делает замену внутри слов намеренным поведением. Утверждение автора подтверждено, сам эффект даже сильнее, чем он описал. Severity medium: в реальных dev/staging-конфигурациях с коротким ключом результат получается неверным, но для этого нужен короткий секрет из обычного слова.
- *repro*: confirmed (conf 0.7) — Воспроизвёл против dist/protocol/trace.js и dist/redact.js. Значение 'test' не попадает в TRIVIAL, остаётся в values и заменяется внутри слов sk-test-abc и attestation. Секрет 'redact' портит маркер, уже вставленный вместо более длинного секрета, потому что замены идут от длинных к коротким, а результат каждой замены сканируется снова. Поведение подтверждено фактически. Последствия ограничены косметикой отчёта: секрет не утекает, а настоящие токены редко бывают словарными словами длиной 4–6 символов. Если ввести границы слов, можно пропустить секрет, приклеенный к буквам и цифрам. Поэтому severity снижена до low.

### F135 [medium/security] Инъекция ANSI-escape и GitHub workflow-команд через серверные строки в текстовом отчёте

**Where.** `src/report/text.ts:52` (reviewer: security-lens)

**What.** renderText (src/report/text.ts) печатает строки от сервера как есть: subject/tool name (стр. 52, 56), serverName(snap) (стр. 97), coverage.reason/fatal (стр. 106-107), fixSnippets (стр. 81/130) и skipped.reason. ESC, CR и LF никак не экранируются. Сервер с именем инструмента или serverInfo.name, где есть ESC и '\n::warning::...', получает в stdout свои ANSI-последовательности (перекраска или очистка экрана) и строки, которые начинаются с '::'. В GitHub Actions runner разбирает такие строки как workflow-команды: можно подделать аннотации, выполнить add-mask или stop-commands. Для собственных аннотаций проект экранирует строки через escapeCommand (src/report/github.ts), а для текстового отчёта такого экранирования нет. escapeHidden из rules/util/text.ts в отчётах не применяется. Severity снижена до medium: секреты не утекают и основной сценарий не ломается. Злонамеренным должен быть сам проверяемый сервер, а последствия — подмена вывода терминала и логов CI.

**Evidence.** Мини-репро на dist (снапшот с serverInfo.name='Evil\u001b[2J\u001b[31m SERVER\n::error::fake…' и tool.name='\u001b[32mgood_tool\u001b[0m\n::warning::injected'): renderText вернул строки "Server  Evil\u001b[2J\u001b[31m SERVER", "::error::fake annotation from server 1 · https://x.example/mcp", "  x TOOL-006 [claude] \u001b[32mgood_tool\u001b[0m", "::warning::injected: no title" (всего 20 строк с ESC или ведущим '::'); renderMarkdown: `md has ESC: true`. Код: text.ts:52 `${subject(f)}: ${f.message}`, :97 `Server  ${serverName(snap)}`, :107 coverage.reason; cli.ts:321 `stderr += `[stdio stderr]\n${stderrTail}\n``. Тесты (test/report.test.ts:197) проверяют только отсутствие собственных ANSI при color:false, не серверные.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f135.mjs (вызывает renderText из dist/report/text.js с serverInfo.name='Evil\u001b[2J\n::error::fake' и tool.name='\u001b[32mgood\u001b[0m\n::warning::injected', color:false). Вывод, строки с ESC или с ведущим '::':
"Server  Evil\u001b[2J"
"::error::fake · stdio:x"
"  x TOOL-006 [claude] \u001b[32mgood\u001b[0m"
"::warning::injected: no title"
"  \u001b[32mgood\u001b[0m"
"::warning::injected: {\"title\":...}"  (из секции FIX SNIPPETS)
```

**Suggested fix.** Ввести одну функцию sanitize (на базе escapeHidden из rules/util/text.ts: \p{Cc}/\p{Cf} → \u{..}, CR/LF → пробел) и применять её в renderText ко всем строкам, пришедшим от сервера (subject, message, serverName, coverage.reason, fatal, fixSnippets, skipped.reason), к `[stdio stderr]`/`[http]` в --verbose и в markdown text()/cell(). В режиме GITHUB_ACTIONS дополнительно гарантировать, что ни одна строка stdout/stderr не начинается с '::' (например, префикс пробелом или замена '::' на ': :'). Добавить тест с ESC/CRLF/'::' в name, serverInfo и stderr.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Строки актуальны: text.ts:52 `${subject(f)}: ${f.message}`, :97 `Server  ${serverName(snap)}`, :106-107 coverage.reason. serverName (src/report/index.ts:72) возвращает serverInfo.title/name без обработки. Через grep по src нашлись только два средства экранирования. escapeHidden используется лишь в цитатах правил INJ. escapeCommand применяется только в github.ts к собственным аннотациям, то есть проект знает об этой угрозе, но текстовый stdout не защищён. Ни выше, ни ниже по стеку санитизации нет. Тест test/report.test.ts:197 проверяет только, что при color:false нет собственных ANSI-кодов. Теста, который бы фиксировал вывод серверных управляющих символов как намеренное поведение, нет. В spec.md экранирование hidden-символов прописано только для цитат INJ (§585), противоречия с утверждением нет. Repro на dist подтвердил находку. Severity high завышена: секреты не утекают и основной сценарий не ломается, а атака требует, чтобы проверяемый сервер был злонамеренным. Поэтому medium.
- *repro*: confirmed (conf 0.9) — Проблема воспроизвелась на dist/*.js. Снапшот test/fixtures/snapshots/minimal-http.json прогнан через buildReport и renderText с color:false. Затем подменены serverInfo.name и tool.name: в них вставлены ESC-последовательности и '\n::error::' / '\n::warning::'. В выводе 20 строк содержат ESC или начинаются с '::'. Сырые ESC появляются в строке Server и в строках TOOL-006/011/012. Отдельные строки '::error::fake annotation…' и '::warning::injected…' возникают из-за LF внутри имени. renderMarkdown тоже содержит ESC. Экранирования нет ни в text.ts, ни в serverName (src/report/index.ts:72). escapeHidden из rules/util/text.ts в рендерерах не применяется. Значит, замечание по существу верное. Severity снижена до medium: код не выполняется, секреты не утекают, а workflow-команды set-env и set-output в GitHub отключены. Остаются подделка и сокрытие аннотаций и вывода в терминале, причём сервер должен быть враждебным. Утверждение про `[stdio stderr]` в cli.ts:321 проверено только чтением кода (там stderrTail печатается сырым), не запуском.

### R002 [medium/bug] Остановка --max-duration во время connect stdio теряет stderr сервера, хотя в fix SRV-003 написано, что он показан

**Where.** `src/connect.ts:656` (reviewer: deadline-signals)

**What.** Если --max-duration срабатывает до ответа на initialize, stderr stdio-сервера теряется. stderrTail живёт локально в connectStdio, а progress.stderrTail и progress.nonJsonStdout присваиваются в buildStdio (src/connect.ts:473-476) только после успешного connect. Поэтому stoppedSnapshot (стр. 656) не заполняет transport.stdio, withDeadline возвращает stderrTail: undefined, fatal не содержит stderrSummary, а --verbose не печатает [stdio stderr] (cli.ts:321). Путь с --timeout в той же ситуации кладёт сводку stderr в fatal (стр. 455). Fix SRV-003 при этом утверждает «the stderr cause is shown above; --verbose prints all of stderr». Исправление: публиковать геттер stderrTail и массив nonJson в progress сразу после создания transport, до await connect, а в stoppedSnapshot для фазы connect добавлять stderrSummary в fatal.

**Failure scenario.** Сервер в CI зависает на старте и пишет в stderr «waiting for DATABASE_URL». С --max-duration пользователь видит только «no handshake within --max-duration» без причины, даже с --verbose.

**Evidence.** Команда `--verbose --max-duration 1500 --env NOINIT=1 --env 'STDERR=srv: waiting…' --stdio -- node srv.mjs` даёт exit 3: «Could not connect: stopped by --max-duration (1500 ms) during connect», «x SRV-003 … no handshake within --max-duration (1500 ms)», fix «(the stderr cause is shown above; --verbose prints all of stderr)». stderr-файл CLI при этом пуст. Тот же сервер с `--timeout 1500` выдаёт «Could not connect: MCP error -32001: Request timed out; stderr: …» и печатает «[stdio stderr]» в stderr. Файлы: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/stopconnect.txt, /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/stopconnect.err

**Repro (verifier).**

```
Запускал не я, проверены файлы автора в /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/. Команда: `--verbose --max-duration 1500 --env NOINIT=1 --env 'STDERR=srv: waiting…' --stdio -- node srv.mjs`. В stopconnect.txt: «Could not connect: stopped by --max-duration (1500 ms) during connect», «x SRV-003 [spec] server: stdio server did not start: no handshake within --max-duration (1500 ms)», fix «(the stderr cause is shown above; --verbose prints all of stderr)». stopconnect.err — 0 байт, блока [stdio stderr] нет. Причина в коде: src/connect.ts:473-476 (присваивание только после успешного connect), :555 (stderrTail: progress.stderrTail?.() даёт undefined), :656 (условие progress.stderrTail ложно).
```

**Suggested fix.** В connectStdio сразу после создания transport записывать `if (progress && !progress.stderrTail) { progress.stderrTail = () => stderrTail; progress.nonJsonStdout = nonJson; }`, т.е. до await connect. В stoppedSnapshot для фазы connect добавлять stderrSummary в fatal, как это делает путь с таймаутом.

**Verifier votes.**

- *reader*: confirmed (conf 0.9) — Утверждение подтверждается кодом. В connectStdio (src/connect.ts:424-457) stderrTail — локальная переменная. Наружу она уходит только двумя путями: через return (stderr: () => stderrTail) после успешного client.connect или через throw с полем stderrTail. progress.stderrTail и progress.nonJsonStdout присваиваются в buildStdio (стр. 473-476) только после успешного connectStdio. Если --max-duration срабатывает раньше, чем завершился initialize, withDeadline (стр. 555) вызывает stoppedSnapshot, а там строка 656 требует progress.stderrTail. Поле не задано, поэтому snap.transport.stdio не заполняется, stderrTail в результате равен undefined, и cli.ts:321 не печатает блок [stdio stderr]. Сам run в этот момент брошен: run.catch(() => {}) молча проглатывает ошибку, даже если connectStdio потом бросит её со stderrTail. В stoppedSnapshot fatal = 'no handshake within --max-duration (...)', сводки stderr в нём нет, хотя путь с --timeout (стр. 455) её добавляет. Fix-текст SRV-003 (src/rules/server.ts:76) обещает «the stderr cause is shown above; --verbose prints all of stderr», а в этом сценарии это неправда. Тест, который делал бы такое поведение намеренным, я не нашёл: test/e2e-stdio.test.ts:269-277 проверяет только exit 3, phase 'connect' и сообщение SRV-003, а stderr не проверяет. spec.md эту ситуацию не описывает. В known-round1.json (лежит в evidence/04-round2/, а не в evidence/, как сказано в задании) дубля нет: F031, F011 и F162 касаются --max-duration, но про другое. Repro автора подтверждается файлами в scratchpad: stopconnect.txt показывает «Could not connect: stopped by --max-duration (1500 ms) during connect» и fix со ссылкой на stderr, а stopconnect.err пуст (0 байт). Severity medium оставляю, но это на границе с low. Вердикт (SRV-003 error, exit 3) верный, теряется только диагностика. Зато сценарий типичный: CI с --max-duration и сервер, который виснет на старте из-за конфигурации. Fix-текст при этом прямо вводит в заблуждение.
- *repro*: confirmed (conf 0.9) — Код подтверждает механизм: progress.stderrTail = conn.stderr выставляется только после того, как await connectStdio завершился успешно. stoppedSnapshot добавляет stdio/stderrTail только при наличии progress.stderrTail. withDeadline берёт stderrTail из progress.stderrTail?.(), а там undefined. Независимо воспроизвёл через dist/cli.js на собственном зависающем сервере: он пишет в stderr и не отвечает на initialize. С --max-duration 1500 stderr CLI пуст, а в отчёте нет причины, хотя fix ссылается на «stderr cause shown above». С --timeout 1500 причина в fatal есть, и --verbose печатает [stdio stderr]. С находками первого раунда не пересекается: в FINDINGS/01-find-raw по max-duration+stderr есть только F031/F162/F135, и они про другое. Severity понижена: страдает только диагностика, и только при max-duration < timeout.

### R007 [medium/bug] Ошибка SSE-fallback теряется: legacy SSE с OAuth выдаётся за «HTTP 404 not an MCP endpoint», auth-проба не запускается

**Where.** `src/connect.ts:217` (reviewer: sse-legacy-modern)

**What.** Если и Streamable POST (400/404/405), и SSE-fallback не подключились, connectLegacyHttp возвращает ошибку POST, а ошибку SSE (статус SseError.code и сообщение) отбрасывает. Из-за этого для legacy SSE сервера, у которого auth стоит только на GET /sse, а POST /sse не смонтирован, 401 не замечается. authFailed=false, auth-проба не запускается, coverage выставляется в 'connect-failed', и пользователь получает ложное «not an MCP endpoint; ... usually serve /mcp». Ошибки SDK SSE (например, «Endpoint origin does not match connection origin») не попадают в диагностику. Если auth покрывает и POST /sse, всё работает корректно, потому что POST получает 401.

**Failure scenario.** Express/Starlette legacy SSE сервер с per-route OAuth на GET /sse: линтер пишет «не MCP-эндпоинт, попробуйте /mcp», exit 3, auth-правила (AUTH-*) и чеклист OAuth не запускаются.

**Evidence.** Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/a_sse401.mjs (POST любой → 404, GET /sse → 401 + WWW-Authenticate resource_metadata):
era unknown kind streamable-http
coverage {"toolLevel":"connect-failed","reason":"HTTP 404: http://127.0.0.1:33507/sse is not an MCP endpoint; /sse is the deprecated HTTP+SSE path; Streamable HTTP servers usually serve http://127.0.0.1:33507/mcp"}
authProbe? false undefined
exchanges preflight POST 404 | discover POST 404 | sdk initialize POST 404 | sdk GET GET 401
Скрипт f_sse_endpoint.mjs (GET /sse отдаёт `event: endpoint` с http://internal-backend:8000/...): fatal «HTTP 405: … not an MCP endpoint …», mentions endpoint origin? false.
Код: connect.ts:217-221 `const sse = await connectSse(...); if (sse.ok) return sse; } return last;`, connect.ts:249 `return { ok: false, message: \`SSE fallback: ...\` }` (без status/cause).

**Repro (verifier).**

```
/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/a_sse401.out:
era unknown kind streamable-http
coverage {"toolLevel":"connect-failed","reason":"HTTP 404: http://127.0.0.1:33507/sse is not an MCP endpoint; /sse is the deprecated HTTP+SSE path; Streamable HTTP servers usually serve http://127.0.0.1:33507/mcp"}
authProbe? false undefined
exchanges preflight POST 404 | discover POST 404 | sdk initialize POST 404 | sdk GET GET 401
/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/f_sse_endpoint.out:
fatal: ... HTTP 405: .../sse is not an MCP endpoint ...; mentions endpoint origin? false
```

**Suggested fix.** Сохранять результат SSE-попытки: в connectSse брать `(e as SseError).code` как status и класть его вместе с сообщением в LegacyConn (например, `last.sseStatus` и `last.sseMessage`). В buildHttp считать `conn.sseStatus === 401` отказом авторизации: ставить authFailed и trigger 'preflight-401', а challengeExchange брать из exchange 'sdk GET' со статусом 401. В describeHttpFailure, если GET /sse ответил 200 или 401, не советовать /mcp и показывать текст SSE-ошибки. Для этого случая выставлять transport.kind='sse'.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Подтверждаю. Код актуален. В src/connect.ts:217-221 результат connectSse используется только при sse.ok, иначе функция возвращает `last`, то есть 404/405 от Streamable POST. В connectSse (около :249) ошибка возвращается как `{ok:false, message:'SSE fallback: ...'}`: в ней нет status/cause, и дальше её никто не читает. Выше по стеку случай тоже не обрабатывается. В buildHttp authFailed считается так: `conn.status === 401 || (!conn.ok && !discOk && disc.exchange.status === 401)`. Здесь preflight и discover оба POST и получают 404, поэтому trigger не ставится и runAuthProbe не вызывается. Затем describeHttpFailure (src/diagnose.ts:81-87) для 404/405 на пути /sse выдаёт kind 'not-mcp' с советом использовать /mcp. Перехват 401 есть только в src/rules/spec.ts:119, и он не помогает. Тестов, которые фиксировали бы такое поведение как намеренное, я не нашёл. Spec (стр. 1171) описывает только сам fallback, а стр. 867 прямо упоминает Asana `/sse` с OAuth, так что legacy SSE с OAuth — реальный сценарий, который линтер должен обрабатывать. Repro перепроверил по сохранённым выводам a_sse401.out и f_sse_endpoint.out: оба совпадают с утверждением. Чего нет в находке: случай узкий. Если auth-middleware стоит на всём /sse, включая POST, то POST получает 401 и authFailed срабатывает правильно. Ломается только сценарий, где auth стоит на отдельном маршруте GET, а на POST маршрута нет (404/405), плюс случай с mismatch origin у endpoint. Поэтому оставляю severity medium: результат неверный в реальных случаях (fatal с ложным советом про /mcp, exit 3, правила AUTH-* пропущены), но это не основной сценарий.
- *repro*: confirmed (conf 0.85) — Код совпадает с описанием. В connect.ts:217-221 результат connectSse используется только при sse.ok, иначе возвращается `last`, то есть ошибка POST initialize (404/405). connectSse (connect.ts:249) возвращает { ok:false, message:'SSE fallback: ...' } без status, и это значение выбрасывается. В buildHttp authFailed считается только по conn.status===401 или по 401 на discover, а trigger ставится только по preflight (POST). Поэтому 401 на GET /sse не включает ни authProbe, ни coverage 'auth-required'. describeHttpFailure получает status=404 и советует /mcp. Я сам перезапустил a_sse401.mjs против dist/connect.js, результат тот же. Повторно не перезапускал f_sse_endpoint.mjs, но его сохранённый вывод (f_sse_endpoint.out) показывает 405 и что ошибка про origin endpoint не выводится. В первом раунде дублей нет: в known-round1 по SSE есть только F024, F028 и F142, все про SSE-watcher и парсер, а не про fallback. Severity medium подходит. Это неверный результат в реальном, но не основном сценарии: legacy SSE устарел, а если auth глобальный (`app.use(auth)`), POST тоже даёт 401 и случай обрабатывается правильно. Проблема только при auth на отдельном маршруте GET /sse или при ошибке SSE-handshake за прокси.

### R008 [medium/bug] SRV-010 измеряет время до заголовков: для SSE-ответов (дефолт SDK Streamable HTTP) и legacy SSE (202) задержка не видна

**Where.** `src/protocol/trace.ts:185` (reviewer: sse-legacy-modern)

**What.** finishHeaders пишет в timings[method] `ex.durationMs`, а это время до получения заголовков. SDK StreamableHTTPServerTransport по умолчанию (enableJsonResponse=false) отвечает text/event-stream: 200 и заголовки уходят сразу, а результат приходит позже. Поэтому медленный tools/list даёт сэмплы около 1 мс. В legacy HTTP+SSE POST на /messages возвращает 202 Accepted мгновенно, а ответ приходит по GET-потоку, который tracer вообще не измеряет. В обоих случаях SRV-010 не срабатывает, хотя реальная задержка 1.5 с. Поле bodyMs уже есть, но правило его не использует. Это не то же, что F021/F059: там речь о том, какие пробы попадают в выборку, а здесь о самой метрике.

**Failure scenario.** Сервер на дефолтном SDK (SSE-ответы) или legacy SSE с tools/list 1.5–10 с: SRV-010 молчит (нет ни info >500 мс, ни warning >5 с), задержка отчёта занижена в 100–1000 раз.

**Evidence.** c_shttp_sse_latency.mjs (SDK stateless server, tools/list спит 1500 мс):
mode SSE responses era legacy kind streamable-http
timings tools/list [8,5,1,1]
sdk tools/list 200 text/event-stream durationMs=8 bodyMs=1511 | … durationMs=1 bodyMs=1503
mode enableJsonResponse … timings tools/list [1515,1,1503,1504]
b_sse_latency.mjs (SDK SSEServerTransport, tools/list 1500 мс):
era sse-legacy kind sse; timings tools/list [1,1,1]; sdk tools/list 202 1ms url=…/messages?sessionId=…
SRV-010 []
Код: trace.ts:185-190 `ex.durationMs = now() - started; … (timings[method] ??= []).push(ex.durationMs)`.

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r008.mjs. Он вызывает createTracer из dist/protocol/trace.js против http-сервера, который сразу отдаёт 200 text/event-stream и пишет ответ на tools/list через 1500 мс. Сервер вызывается через tracer.fetch (SDK-путь) и через tracer.request с fullBody. Вывод:
timings {"tools/list":[17.49,2.58]}
sdk tools/list 200 text/event-stream durationMs 17 bodyMs 1517
probe 200 text/event-stream durationMs 3 bodyMs 1506
```

**Suggested fix.** Для JSON-RPC exchanges писать в timings время до ответа с нужным id: bodyMs при stoppedAtResponse или при полном теле, а не durationMs. Для SDK-пути писать после readBody в sdkFetch. Для transport.kind==='sse' мерить в RecordingTransport интервал от send(id) до record(id) и класть его в timings. Ответы 202 без JSON-RPC тела в timings не писать.

**Verifier votes.**

- *reader*: confirmed (conf 0.88) — Утверждение подтверждается: опровергнуть его не удалось. В src/protocol/trace.ts строки 185-190 актуальны. finishHeaders записывает `ex.durationMs = now() - started` сразу после того, как `await fetch()` вернул заголовки, и тут же кладёт это значение в `timings[method]`. bodyMs считается позже (в sdkFetch внутри pending readBody, в request после readBody), но в timings не попадает. Других путей нет: в connect.ts:371 timings берутся напрямую из `snap.transport.timings = tracer.timings`, ниже по стеку ничего их не пересчитывает и не компенсирует. Правило SRV_010 в src/rules/server.ts:249-266 берёт медиану именно по этим числам. В SDK 1.32.1 (node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js:608-640) режим SSE-стрима включён по умолчанию: Response с ReadableStream и заголовками 200 text/event-stream возвращается сразу, а результат дописывается в поток позже. Только при enableJsonResponse ответ ждёт результата. Тесты test/rules/server.test.ts:41-42 и :114 проверяют правило на готовых числах timings и не фиксируют, что задержка намеренно считается до заголовков. Спека (docs/RULES.md:195-196) говорит только «timings of initialize ... tools/list», а по смыслу правила («latency», «sluggish») нужна задержка до получения ответа, а не TTFB. Дубликатом это не является. F021 и F059 касаются состава выборки (пробы, коды статусов), F024 — сравнения id в watcher. Метрику «время до заголовков» в первом раунде никто не поднимал. Severity оставляю medium: на серверах с дефолтными настройками SDK (а таких большинство) SDK-сэмплы занижены, поэтому SRV-010 даёт ложноотрицательный результат и не выдаёт ни info, ни warning при задержке больше 5 с. Само правило при этом информационное (chatgpt: info/warning), секреты и безопасность не затронуты, поэтому до high не повышаю. Legacy SSE (202 и ответ по GET-потоку) я отдельно не перепроверял, но по коду поведение то же: время POST до 202 попадает в timings, а GET-поток, на котором `isStream`, не измеряется.
- *repro*: confirmed (conf 0.9) — Подтверждено на живом SDK-сервере. Для Streamable HTTP проверял локальный сервер на SDK 1.32.1 (stateless, tools/list спит N мс) через dist/connect.js buildSnapshot и правило SRV-010 из dist/rules. В режиме по умолчанию (enableJsonResponse=false, ответ text/event-stream) заголовки приходят сразу. finishHeaders (src/protocol/trace.ts:185-190) кладёт в timings время до заголовков `ex.durationMs`, это 1–6 мс, хотя полное время ответа (`bodyMs`) равно 1506 и 6007 мс. При задержке 6 с ветка warning (>5 s) не срабатывает. Тот же сервер с enableJsonResponse=true даёт сэмплы около 6005 мс, и warning появляется. Значит, проблема в самой метрике, а не в составе выборки (F021 и F059 — про другое), это не дубль.

Ветку legacy HTTP+SSE (POST 202, результат идёт по GET-потоку, который tracer не измеряет) я не воспроизводил. По коду она правдоподобна: для GET с event-stream bodyMs вообще не пишется. У автора есть отдельное evidence (b_sse_latency.mjs).

Severity medium оставляю. Это дефолтная конфигурация официального SDK, и правило молчит даже при задержке больше 5 с. Но SRV-010 касается только ChatGPT, уровни info и warning, так что high не нужен. Попутно: info-ветка (медиана >500 мс) не сработала и в JSON-режиме при 1.5 с, потому что медиану размывают быстрые initialize и badVersion. Это уже покрыто F021/F059.

### R009 [medium/security] Для legacy HTTP+SSE Origin-пробы пропускаются, и SRV-008 молча «проходит» на локальных SSE-серверах (DNS rebinding)

**Where.** `src/probe/wire.ts:73` (reviewer: sse-legacy-modern)

**What.** Для transport.kind === 'sse' Origin-пробы не отправляются (wire.ts:73). SRV-008 при этом не помечается как skipped, потому что needs:['http'] выполнено, и возвращает []. В итоге в отчёте правило выглядит пройденным, а это противоречит принципу spec.md §1 «skipped… never as passed». Локальный legacy SSE сервер, который принимает чужой Origin (риск DNS rebinding), не получает spec error, хотя на Streamable HTTP получил бы. Исправление: отправлять GET с Accept: text/event-stream и разными Origin (abortAfterHeaders) в те же слоты originNone/originEvil. Минимальный вариант: для SSE записывать SRV-008 в skipped с причиной «Origin not probed on legacy SSE».

**Failure scenario.** Локальный legacy SSE сервер принимает любой Origin: линтер не выдаёт spec error про DNS rebinding, хотя для того же сервера на Streamable HTTP выдал бы.

**Evidence.** b_sse_latency.mjs: локальный SSE-сервер 127.0.0.1 (localMode=true, SSEServerTransport без allowedOrigins):
probes discover,unknownMethod,unknownTool,challenge
SRV-008 [] []   (findings=[], skipped=[])
Код: wire.ts:73 `if (snap.transport.kind !== 'sse') Object.assign(p, await originProbes(...))`; server.ts:201-215: при отсутствии проб правило ничего не возвращает.

**Repro (verifier).**

```
Статический разбор: в src/probe/wire.ts:73 для SSE нет originProbes. В src/rules/server.ts:202-216 probeExchange(...) возвращает undefined, следовательно out=[]. Движок не ставит skipped, потому что needs:['http'] выполнено. В тестах нет кейса SSE+SRV-008 (grep по test/: только e2e-http.test.ts:64,88 и rules/server.test.ts:31,107,135, всё для Streamable HTTP или синтетических проб). Вывод автора подтверждает это: локальный SSEServerTransport на 127.0.0.1 даёт probes discover,unknownMethod,unknownTool,challenge и `SRV-008 [] []`.
```

**Suggested fix.** Для SSE отправлять GET на url с `Accept: text/event-stream` и Origin none/claude/chatgpt/evil (abortAfterHeaders), складывать результаты в те же originNone/originEvil. Тогда SRV-008 сравнит 200 с 403. Минимальный вариант: возвращать из SRV-008 inconclusive/skipped «Origin not probed on legacy SSE».

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Опровергнуть не удалось. В src/probe/wire.ts:73 стоит `if (snap.transport.kind !== 'sse') Object.assign(p, await originProbes(...))`, поэтому для legacy HTTP+SSE пробы originNone/originClaude/originChatgpt/originEvil не создаются. Выше по стеку SSE отдельно не обрабатывается. В src/connect.ts:246/304 выставляются kind 'sse' и era 'sse-legacy', а замены пробам нет. Ниже по стеку SRV-008 (src/rules/server.ts:193-218) объявляет только needs:['http']. Для SSE это условие выполнено, поэтому движок не помечает правило как skipped. Без проб probeExchange возвращает undefined, `is2xx(evil)` равно false, и правило возвращает []. Другие правила обрабатывают SSE явно: SPEC-*, spec.ts:81 и :119, `if (snap.transport.kind === 'sse') return []`, а SRV-004 (server.ts:86) сообщает только 'legacy HTTP+SSE only' без связи с Origin. В test/rules/server.test.ts и test/e2e-http.test.ts нет теста, который закреплял бы молчание SRV-008 на SSE как намеренное поведение. CHANGELOG тоже ничего про это не говорит. Утверждение согласуется со spec.md, а не противоречит ему. В §1 (строка 46) сказано: «When the snapshot lacks that data, the engine records the rule as skipped… never as passed». В описании SRV-008 (строки 175-183) и в таблице проб §4.3 исключения для SSE нет. Сейчас правило на SSE фактически выглядит пройденным, а это нарушает принцип из spec. Пропуск POST-проб на SSE сам по себе объясним: POST на SSE-endpoint бессмысленен, сообщения идут на отдельный message endpoint. Но замены нет (GET с Origin на SSE url), и нет пометки skipped/inconclusive. Строка актуальна. В known-round1 есть только похожая находка F019 (пропуск SRV-008 из-за same-host редиректа), это другая причина, дубликата нет. Severity medium оставляю: проверка безопасности (DNS rebinding на loopback) на реальном классе серверов молча даёт ложный «pass». Выше не поднимаю, потому что транспорт устаревший и SRV-004 всё равно отмечает сам факт SSE-only.
- *repro*: confirmed (conf 0.85) — Проблема воспроизведена. В src/probe/wire.ts:73 originProbes вызываются только при `snap.transport.kind !== 'sse'`. SRV-008 (src/rules/server.ts:200-216) при отсутствии originNone, originClaude, originChatgpt и originEvil возвращает [] и не помечает себя ни как skipped, ни как inconclusive. Это не дубль первого раунда: F019 говорит о пропуске SRV-008 из-за same-host редиректа, а здесь другая причина. В spec.md:175-183 SRV-008 описан без исключения для SSE. Требование спецификации MCP 2024-11-05 (HTTP+SSE) проверять Origin против DNS rebinding к legacy-транспорту тоже относится. Живой прогон на локальном SSE-сервере из SDK без allowedOrigins подтвердил: ни один запрос линтера не несёт заголовок Origin, SRV-008 нет ни в findings, ни в skipped, при этом сервер отвечает 200 на GET /sse с `Origin: https://evil.example`. Для такого же локального сервера на Streamable HTTP SRV-008 выдаёт spec error (это видно по evidence F019 для /mcp/). Severity medium оставляю. Это ложноотрицательный результат проверки безопасности в реальном сценарии: локальный legacy SSE-сервер, класс CVE-2025-49596. Выше не ставлю по двум причинам: транспорт устаревший, и по умолчанию spec-находки не влияют на результат запуска (gate).

### R032 [medium/bug] APPS-006: wildcard на многоуровневых публичных суффиксах (`https://*.co.uk`, `*.com.au`) и общих облачных доменах не считается overly broad

**Where.** `src/rules/apps.ts:134` (reviewer: limits-apps)

**What.** APPS-006 не считает overly broad wildcard на многоуровневом публичном суффиксе (`https://*.co.uk`, `https://*.com.au` и другие суффиксы из MULTI_LABEL). Проверка `!wild[2].includes('.') || SHARED_HOST_SUFFIXES.includes(...)` не учитывает MULTI_LABEL. Из-за этого в resourceDomains такая запись не даёт ни одной находки, а в остальных полях — только spec info. Это противоречит spec.md:753 («a wildcard on a public or shared suffix»). Исправление: считать запись широкой, если `registrableDomain('x.' + rest) !== rest`, то есть rest — сам суффикс. Добавлять ли облачные CDN и хранилища (cloudfront.net, amazonaws.com и т. п.) в SHARED_HOST_SUFFIXES — отдельное и необязательное решение.

**Failure scenario.** resourceDomains: ["https://*.co.uk"] открывает загрузку скриптов с любого британского домена, а линтер молчит.

**Evidence.** /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2b.out: `["https://*.co.uk"] -> []`, `["https://*.cloudfront.net"] -> [только APPS-007]`, тогда как `https://*.com` -> `overly broad`; r2apps.out: для connectDomains `*.co.uk`/`*.com.au`/`*.amazonaws.com` выдаётся только `{spec:info} wildcard ... outside resourceDomains`.

**Repro (verifier).**

```
/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2b.out: ["https://*.co.uk"] -> [] ; ["https://*.com"] -> ['APPS-006: resourceDomains: "https://*.com" is overly broad'] ; ["https://*.cloudfront.net"] -> [только APPS-007]. r2apps.out: APPS-006 {"spec":"info"} connectDomains: wildcard "https://*.co.uk" outside resourceDomains.
```

**Suggested fix.** Считать broad, если `registrableDomain('x.'+rest) !== rest` (то есть rest — это публичный суффикс), с использованием MULTI_LABEL; добавить облачные CDN/хранилища в общий список (или в SHARED_HOST_SUFFIXES).

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Подтверждаю. В src/rules/apps.ts:133-134 запись считается широкой, только если она есть в BROAD, или если остаток wildcard не содержит точки, или он точно совпадает с элементом SHARED_HOST_SUFFIXES. Для `*.co.uk` остаток `co.uk` содержит точку, а в SHARED_HOST_SUFFIXES его нет (он есть только в MULTI_LABEL в src/rules/util/net.ts:54, и этот список не экспортируется и в APPS-006 не используется). Поэтому запись проходит как узкая. Выше по стеку этот случай никто не обрабатывает. APPS-007 и APPS-008 используют registrableDomain только для других целей. Теста, который делал бы такое поведение намеренным, нет: в test/ про co.uk есть только registrableDomain('a.b.acme.co.uk'). Код противоречит spec.md:753: «a wildcard on a public or shared suffix (`https://*.com`, `https://*.vercel.app`)», а `co.uk` и `com.au` — публичные суффиксы. Строка актуальна. Готовый repro лежит в /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2b.out: `["https://*.co.uk"] -> []`, а `["https://*.com"]` даёт `APPS-006: resourceDomains: "https://*.com" is overly broad`. В r2apps.out для `*.co.uk` в connectDomains есть только `{spec:info} wildcard outside resourceDomains`. В первом раунде дубликата нет: F106 — про двойной отчёт, F096 — про INJ-008. Оговорка: часть про `*.amazonaws.com`, `*.cloudfront.net` и другие облачные домены слабее. В spec этих доменов в качестве примеров нет, а состав SHARED_HOST_SUFFIXES — это выбор проекта, поэтому на этой части я не настаиваю. Ядро находки (многоуровневые публичные суффиксы из MULTI_LABEL) подтверждено. Severity оставляю medium: в реальных случаях результат неверный, и это ложноотрицательный результат в проверке, связанной с безопасностью. До high не дотягивает, потому что основной сценарий не ломается, а `*.co.uk` в реальном CSP встречается редко.
- *repro*: confirmed (conf 0.85) — Сначала проверил, не повтор ли это: в known-round1.json для src/rules/apps.ts по APPS-006 есть только F106 (дублирование записи при ui.csp и openai/widgetCSP одновременно). Похожий по смыслу F096 относится к INJ-008. Значит, R032 — новая находка. По коду: регулярка `/^([a-z]+:\/\/)?\*\.(.+)$/` даёт для `*.co.uk` остаток `co.uk`. В нём есть точка, а SHARED_HOST_SUFFIXES не содержит co.uk, поэтому запись проходит как узкая. Независимый repro против dist/ это подтверждает: `*.co.uk`, `*.com.au` и облачные домены в resourceDomains дают [], тогда как `*.com` и `*.vercel.app` дают «overly broad» warning. Расхождение со spec.md:753 есть. Severity понижаю: это пропущенная эвристическая находка уровня warning, а не неверный результат в типичном сценарии.

### R046 [medium/bug] [Переоценка F141 + F033] 100 МБ не-JSON строк в stdout роняют линтер с heap OOM (exit 134, отчёта нет); основной источник роста памяти — transportErrors, а не nonJson

**Where.** `src/protocol/recording.ts:25` (reviewer: bearer-preflight-buffers)

**What.** RecordingTransport (src/protocol/recording.ts:25) сохраняет без лимита каждый Error из `inner.onerror`. SDK вызывает onerror(SyntaxError) на каждую не-JSON строку stdout и транспорт при этом не закрывает, а массив `transportErrors` никто не читает (F033). При около 1 млн таких строк (около 100 МБ) mcp-review-check падает с V8 heap OOM (exit 134), и отчёта нет. Неограниченный `nonJson` в connect.ts:444 добавляет ещё около 700 МБ RSS, но сам по себе до OOM не доводит. Исправление: ограничить `transportErrors` (первые N сообщений плюс счётчик) или вообще их не хранить. Для `nonJson` хранить первые N обрезанных строк плюс счётчик. Для tap-буфера ввести лимит на строку без \n.

**Failure scenario.** stdio-сервер в debug-режиме или с console.log в stdout выводит около 1 млн строк (около 100 МБ) за время проверки: mcp-review-check падает с OOM и не выдаёт ни отчёта, ни exit code по --fail-on.

**Evidence.** Сервер: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/server.mjs (MODE=linespre пишет MB мегабайт строк по 100 байт до ответа на initialize). Раннер: run.mjs.
linespre 50 МБ: exit 0, peakRssMB 1301, nonJsonLines 500000 (linespre50.txt)
linespre 100 МБ: exit 134 «FATAL ERROR: Ineffective mark-compacts near heap limit … JavaScript heap out of memory» (linespre100.txt; heap_size_limit 2144 МБ)
linespre 200 МБ: exit 134 OOM (linespre200.txt)
Копия dist без transportErrors.push (run-noerr.mjs): 100 МБ дают exit 0, peakRssMB 691, 13.8 с (linespre100-noerr.txt)
Микробенчмарк amp.mjs, 500k строк: nonJson strings 14.0 MB, transportErrors 275.7 MB (amp.txt)
nolinepre 4000 МБ: peakRssMB 465, 2.7 с; с IGNTERM: 443 МБ, 6.9 с (noline4000*.txt)

**Repro (verifier).**

```
S=/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2
cd $S && node run.mjs linespre 100   -> exit=134, "FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory" (вывод в $S/rerun100.txt)
Чистая копия dist без push (у автора distcopy с тех пор кто-то изменил, поэтому сделана заново): $S/r046/dist/protocol/recording.js:21 `this.inner.onerror = (e) => { this.onerror?.(e); };`
cd $S/r046 && node run.mjs linespre 100   -> exit=0, "ms": 13609, "peakRssMB": 694, "nonJsonLines": 1000000 (вывод в $S/r046/out.txt)
```

**Suggested fix.** (1) RecordingTransport: хранить не более N transportErrors (например 20, только message) плюс счётчик. (2) nonJson: хранить первые 3–50 строк, обрезанных до 1 КБ, плюс счётчик (SRV-018 использует только length и первые 3). (3) tap: при buf.length больше лимита (например 1 МБ) без \n сбрасывать буфер, засчитывать одну «длинную строку» и не делать Buffer.concat на хвосте.

**Verifier votes.**

- *reader*: confirmed (conf 0.88) — Опровергнуть не удалось. Код актуален. В src/protocol/recording.ts:25 обработчик `inner.onerror` без ограничения кладёт каждый объект Error в `transportErrors`. Массив больше нигде не читается: grep по src/ и test/ находит только объявление и этот push. SDK StdioClientTransport.processReadBuffer (node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js:129-141) ловит ошибку разбора каждой строки и вызывает onerror, не закрывая транспорт. Значит, каждая не-JSON строка stdout даёт один сохранённый SyntaxError со стеком. Ниже по стеку ограничения тоже нет: tap в connect.ts:437-445 без лимита копит `nonJson`, а capSnapshot эти массивы не трогает. Тестов, которые показывали бы, что так задумано, нет. С spec утверждение не расходится: линтер должен выдавать отчёт, а не падать.

Сам перепроверил:
(1) `node run.mjs linespre 100` против актуального dist. Результат: exit=134, «FATAL ERROR: Ineffective mark-compacts near heap limit … JavaScript heap out of memory», то же, что у автора.
(2) Прогон run-noerr.mjs у автора сейчас тоже падает (exit 134). Причина в том, что кто-то после его замера изменил scratchpad/r2/distcopy: push вернули и добавили `globalThis.__errs`. Поэтому сделал свою чистую копию dist (scratchpad/r2/r046), в которой убран только `this.transportErrors.push(e);`. На ней 100 МБ дают exit=0, peakRssMB 694, 13.6 с, nonJsonLines 1000000. Это совпадает с цифрами автора (691 МБ).
Вывод: OOM вызывает именно накопление `transportErrors`. На `nonJson` приходится вторичный, но тоже неограниченный рост около 700 МБ RSS на 100 МБ. Микробенчмарк amp.txt (14 МБ строк против 276 МБ Error на 500 тыс. строк) это подтверждает.

Severity оставляю medium. Процесс аварийно завершается без отчёта и без exit code по `--fail-on`, но для этого нужен stdio-сервер, который пишет около 1 млн строк мусора в stdout. Такой сервер пользователь запускает сам, поэтому граница безопасности слабая. Это сбой надёжности на реальном, хотя и нечастом классе серверов (debug-логирование в stdout). Находка по существу объединяет F141 и F033 и переоценивает их: прежний вердикт по F141 (disputed/low, «просто рост памяти») занижен.
- *repro*: confirmed (conf 0.85) — По коду: в src/protocol/recording.ts:25 обработчик `inner.onerror` безусловно делает `this.transportErrors.push(e)` и хранит полные объекты Error со стеком, без лимита. Массив нигде не ограничен и, по F033, никто его не читает. Буфер nonJson в connect.ts:444 тоже растёт без ограничения, но он дешевле. Tap-буфер (connect.ts:439) делает Buffer.concat без лимита, пока в потоке нет '\n'. Я сам заново запустил тот же harness (dist/connect.js buildSnapshot, stdio-сервер MODE=linespre, 100 МБ строк по 100 байт до ответа на initialize). Процесс падает с exit 134 и V8 heap OOM через 22 с, Snapshot и отчёт не создаются. Это совпадает с evidence автора. Его же материалы показывают, что причина в основном в transportErrors: 50 МБ проходят с пиковым RSS 1301 МБ; копия dist без push проходит 100 МБ с пиком 691 МБ; микробенчмарк на 500k строк даёт 275.7 МБ на transportErrors против 14 МБ на строки nonJson. Severity medium оправдана: нужен необычный, хотя и реалистичный вход (debug-логирование в stdout, около 1 млн строк). Главный сценарий для нормальных серверов не ломается, граница безопасности слабая, потому что stdio-сервер запускает сам пользователь. Но если вход попался, процесс падает полностью, без отчёта и без exit code по --fail-on. Тот же OOM, скорее всего, наступает и раньше 100 МБ, если строки короче. Я этого не измерял.

### C001 [low/bug] stdio/HTTP-сервер, умерший сразу после initialize, получает PASS 100/100 и exit 0, если в capabilities нет tools

**Where.** `src/connect.ts:120` (reviewer: critic)

**What.** Если сервер объявляет capabilities:{} (без tools) и падает или закрывает транспорт сразу после initialize, ошибка транспорта в tools/list (Connection closed / Not connected) нигде не учитывается. Код в connect.ts:120 и правило SPEC-020 (spec.ts:511) реагируют на сбой листинга только при объявленном capability tools или в эре modern. В итоге coverage остаётся 'ok', score 100, CLI печатает PASS и выходит с кодом 0. Это совпадает с буквой docs/design/spec.md: SPEC-020 срабатывает только для объявленных capabilities, а tools/list без capability вызывается лишь ради SPEC-002. Тест test/rules/spec.test.ts:138 закрепляет это намеренно, но только для 'Method not found'. Транспортную ошибку, то есть смерть процесса, спека не разбирает. Получается пробел в дизайне, а не нарушение спеки. Практический охват узкий: большинство реальных серверов объявляют tools, и тогда coverage становится 'list-failed', а SPEC-020 выдаёт error. Пустой сервер без capabilities проверять по существу нечего. Поэтому severity снижаю до low.

**Failure scenario.** stdio-сервер отвечает на initialize с capabilities:{} и завершается (exit 0/crash) — CLI печатает PASS и возвращает 0.

**Evidence.** Мини-репро: `node dist/cli.js --timeout 5000 --format json --stdio -- node -e 'process.stdout.write("{\"jsonrpc\":\"2.0\",\"id\":0,\"result\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"serverInfo\":{\"name\":\"a\",\"version\":\"1\"}}}\n"); setTimeout(()=>process.exit(0),200)'` → EXIT 0, coverage {"toolLevel":"ok"}, summary.score 100, verdicts NO AUTOMATED BLOCKERS, failed:false; текстовый отчёт: «Checked 0 tools … 128 skipped (57 tools/list not available …) … Result: PASS (--fail-on error)».

**Repro (verifier).**

```
cd /home/kali/packages/mcp-review-check && node dist/cli.js --timeout 5000 --format json --stdio -- node -e 'process.stdout.write("{\"jsonrpc\":\"2.0\",\"id\":0,\"result\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"serverInfo\":{\"name\":\"a\",\"version\":\"1\"}}}\n"); setTimeout(()=>process.exit(0),200)' > /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/c001.json; echo EXIT $?
-> EXIT 0; coverage {"toolLevel":"ok"}; summary {"errors":0,"warnings":0,"info":2,"score":100,"verdicts":{"claude":"NO AUTOMATED BLOCKERS","chatgpt":"NO AUTOMATED BLOCKERS"},"failed":false}; findings: только 2 info (stdio/MCPB). Для сравнения: при capabilities:{tools:{}} условие в connect.ts:120 ставит coverage 'list-failed', а SPEC-020 даёт error.
```

**Suggested fix.** Отличать транспортную ошибку (Connection closed, Not connected, timeout, NETWORK_ERROR) от JSON-RPC -32601: при транспортной ошибке ставить coverage 'list-failed'/'connect-failed' независимо от объявленных capabilities и выдавать SPEC-020 (или отдельную находку «server exited after initialize»); для stdio дополнительно проверять, жив ли процесс после listing.

**Verifier votes.**

- *reader*: confirmed (conf 0.6) — Строка актуальна: условие `toolsErr && (caps.tools !== undefined || snap.era === 'modern')` стоит в src/connect.ts:120, условие declared — в src/rules/spec.ts:511. Repro воспроизводится: EXIT 0, coverage {"toolLevel":"ok"}, score 100, оба вердикта NO AUTOMATED BLOCKERS, failed:false, в findings только 2 info про stdio. Почему не опровергнуто: выше и ниже по стеку транспортная ошибка ни во что не превращается. NETWORK_ERROR даёт только повторную попытку, а движок пропускает 57 правил с причиной 'tools/list not available'. Отдельной находки вида «server exited» нет. Почему severity снижена с high до low: (1) docs/design/spec.md:276-278 и 382-383 явно задумывают SPEC-020 только для объявленных capabilities, а тест spec.test.ts:138 'SPEC-020 only for declared capabilities' показывает, что ошибка при необъявленной capability игнорируется намеренно, хотя тест использует 'Method not found', а не транспортный сбой; (2) сценарий требует, чтобы сервер не объявил ни tools, ни других capabilities. Если сервер объявляет tools, что типично, падение после handshake даёт list-failed и SPEC-020 error, гейт срабатывает. Остаётся пробел для пустого сервера, который падает: валидный вывод «Checked 0 tools» и PASS для пустого сервера в целом соответствует замыслу. Предложенный фикс разумен: отличать транспортную ошибку от -32601.
- *repro*: confirmed (conf 0.9) — Подтверждено фактически. В src/connect.ts:118-121 coverage переводится в 'list-failed' только при `toolsErr && (caps.tools !== undefined || snap.era === 'modern')`. NETWORK_ERROR (connect.ts:102) не ловит «Connection closed»/«Not connected», поэтому повторной попытки тоже нет. SPEC-020 (spec.ts:511) проверяет то же условие `declared`. Ошибка в listMeta.tools.error есть: engine.ts:16-18 listOk=false, и правила пропускаются с причиной «tools/list not available». Но authReason возвращает undefined, потому что coverage='ok'. В итоге score 100, оба вердикта NO AUTOMATED BLOCKERS, failed:false, exit 0. Severity снижаю до medium: под удар попадает только сервер, который не объявил capability tools на эре до 2026-07-28 и умер сразу после handshake. Это узкий случай, и такой сервер без tools в каталог всё равно не пройдёт на ручном ревью. Однако как CI-гейт инструмент даёт ложный PASS, хотя «ничего не проверено». Корень проблемы описан верно: транспортный сбой неотличим от «capability не объявлена».

### C002 [low/security] --active: дубликат имени обходит safety-контракт — вызывается имя, у которого другая запись destructiveHint:true

**Where.** `src/probe/active.ts:80` (reviewer: critic)

**What.** runActive (src/probe/active.ts:80-85) фильтрует инструменты по isSafeToCall поэлементно, а tools/call отправляет по имени. Если в tools/list есть две записи с одним именем, одна с readOnlyHint:true, а другая с destructiveHint:true, линтер вызывает это имя. Какая реализация выполнится, решает сервер, и это может быть деструктивная запись. Так нарушается контракт безопасности из spec.md §2.9. Если записи-дубликаты обе безопасны, одно имя ещё и вызывается повторно. Исправление: сгруппировать инструменты по имени, вызывать имя только если все его записи проходят isSafeToCall, вызывать каждое имя один раз, а остальные пропускать с пометкой в snap.active.

**Failure scenario.** Сервер-агрегатор отдаёт два инструмента `sync` (read-only из одного бэкенда и destructive из другого); `--active` вызывает `sync` с синтетическими аргументами и запускает деструктивную операцию.

**Evidence.** Фейковый stdio-сервер с tools=[{name:'dup',annotations:{readOnlyHint:true}},{name:'dup',annotations:{destructiveHint:true}}], логирующий имена tools/call; `node dist/cli.js --active --env LOG=… --stdio "node srv2.mjs weird"` → в логе `1 dup` (плюс mcp_review_check_nonexistent_tool). Код: active.ts:80 `ctx.snap.tools.filter(isSafeToCall)`, active.ts:82-85 вызов по `toolName(t)`.

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/c002.mjs импортирует runActive из dist/probe/active.js. Вместо сервера используется mock ModernClient, который записывает params.name. snap.tools = [{name:'dup',annotations:{readOnlyHint:true}},{name:'dup',annotations:{destructiveHint:true}}]. Вывод: `tools/call names: [ 'dup' ]`. Имя, у которого есть запись с destructiveHint:true, было вызвано.
```

**Suggested fix.** Перед вызовом группировать инструменты по имени и вызывать имя только если ВСЕ записи с этим именем проходят isSafeToCall (и вызывать каждое имя один раз); иначе пропускать с пометкой в snap.active (например skipped: 'duplicate name with unsafe entry').

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Утверждение подтверждается: в src/probe/active.ts:80 стоит `ctx.snap.tools.filter(isSafeToCall).slice(0, MAX_TOOLS)`, а вызов идёт по `toolName(t)` (строки 82-85). Записи не группируются по имени, а безопасность не проверяется для всех записей с одним именем. Выше по стеку этот случай никто не обрабатывает. В test/rules/runtime.test.ts:169-171 isSafeToCall проверяется только на отдельных инструментах, теста на дубликаты нет. spec.md §2.9 (строка 976) требует вызывать только инструменты с readOnlyHint === true и destructiveHint !== true. Если имя неоднозначно, сервер может направить вызов к записи, которая этому контракту не соответствует. Строка 80 в файле указана верно.

Почему понижаю severity до low:
1. Дубликаты имён в tools/list сами по себе нарушают спецификацию, и TOOL-003 о них сообщает.
2. Контракт безопасности целиком держится на аннотациях, которые объявляет сам проверяемый сервер. Сервер, который неверно объявляет хинты, обходит контракт и без дубликатов.
3. `--active` включается явно (opt-in), и обычно им проверяют свой собственный сервер.

Сценарий с агрегатором при этом реалистичен, и исправление дешёвое: вызывать имя только если все записи с этим именем проходят isSafeToCall, и вызывать каждое имя один раз.
- *repro*: confirmed (conf 0.9) — Воспроизведено. В active.ts:80 runActive фильтрует snap.tools через isSafeToCall по каждой записи отдельно, а tools/call отправляет только по имени (toolName(t)). Повторяющиеся имена не группируются, поэтому достаточно одной записи с readOnlyHint:true, чтобы имя ушло в вызов, даже если у другой записи с тем же именем destructiveHint:true. Тогда сервер сам выбирает реализацию по имени. Это нарушает safety contract из spec.md §2.9. TOOL-003 только сообщает о дубликате, когда вызов уже сделан. Одна деталь в failure_scenario неверна: инструмент с именем `sync` вызван не будет, потому что 'sync' входит в WRITE_VERBS (src/rules/lexicon.ts:11) и isSafeToCall его отклоняет. Первый прогон это подтвердил: в логе сервера sync нет. С нейтральным именем, например `workspace_status`, деструктивная реализация вызывается. Severity medium оставляю. Режим --active включается вручную, и обычно проверяют собственный сервер, у которого дубликат уже даёт TOOL-003 error. Но инструмент прямо обещает вызывать только read-only инструменты, а в итоге запускает деструктивную операцию с синтетическими аргументами. Например, на staging-агрегаторе это реальный вред.

### F001 [low/bug] --bearer / MCP_REVIEW_CHECK_TOKEN / --header при --stdio молча выставляют options.authenticated=true и отключают RT-009

**Where.** `src/cli.ts:243` (reviewer: cli-connect)

**What.** Для stdio-цели cli.ts:243 всё равно берёт `values.bearer ?? env.MCP_REVIEW_CHECK_TOKEN`, а `--header` разбирается до ветвления isStdio. Затем buildSnapshot (connect.ts:521) выставляет `options.authenticated = !!bearer || headers>0`, не глядя на `t.kind`. Bearer и заголовки уходят только в buildHttp (connect.ts:271-275) и stdio-серверу никогда не передаются. Из-за этого RT-009 (src/rules/runtime.ts:199) молча возвращает [] и не помечается как skipped. Это расходится с docs/design/spec.md:1025 («when listing worked without credentials»): stdio-сервер получил листинг без учётных данных. Симметричной проверки, как для `--env`/`--cwd` при URL (cli.ts:272), нет. Следствие: ложный пропуск предупреждения RT-009 в режиме --stdio --active, если в окружении экспортирован MCP_REVIEW_CHECK_TOKEN (например, в CI для соседнего HTTP-прогона) или переданы --bearer/--header.

**Evidence.** Мини-репро через dist/connect.js: buildSnapshot({target:{kind:'stdio',...good-server.mjs}, bearer:'tok…', active:true}) -> `stdio snap.options: {"target":"all","active":true,"activeAuth":false,"authenticated":true} calls: 4`. Код: cli.ts:243 `const bearer = values.bearer ?? env.MCP_REVIEW_CHECK_TOKEN ?? undefined;` (до ветвления isStdio), connect.ts:521.

**Repro (verifier).**

```
Свой мини-сервер /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/authtext-server.mjs на SDK из node_modules проекта. У него один инструмент get_data, который отвечает `{isError:true, text:'Not authenticated: please sign in first'}`. Прогон по собранному dist (запускался из того же scratchpad):

for tok in "" "abcdef123456tok"; do MCP_REVIEW_CHECK_TOKEN=$tok node dist/cli.js --stdio "node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/authtext-server.mjs" --active --format json --fail-on never; done

Результат (отфильтрованы находки RT-009 из JSON):
== token=''  -> exit=0, RT-009 findings: 2 ("auth failure returned as isError text without _meta[\"mcp/www_authenticate\"] ..." [chatgpt] | "auth failure returned as isError text; Claude shows text instead of the Connect card; return 401" [claude])
== token=set -> exit=0, RT-009 findings: 0, упоминаний RT-009 в отчёте (в том числе как skipped) нет.

Сам токен stdio-серверу не передаётся, поэтому сервер в обоих прогонах ведёт себя одинаково. Отличается только `options.authenticated`.
```

**Suggested fix.** В cli.ts для isStdio: `--bearer`/`--header` -> UsageError ('apply only to <url>'), а env-токен игнорировать (`bearer = isStdio ? undefined : …`). В buildSnapshot считать `authenticated` только для `t.kind === 'http'`. Добавить тест в test/e2e-stdio.test.ts.

**Verifier votes.**

- *reader*: confirmed (conf 0.9) — Утверждение подтверждено. Ссылка на строку актуальна: cli.ts:243 — `const bearer = values.bearer ?? env.MCP_REVIEW_CHECK_TOKEN ?? undefined;`, это выше ветки `if (isStdio)`, и `headers` тоже собираются до неё. В connect.ts bearer и headers используются только в HTTP-пути: строка 52 (deps для http) и строки 271-275 (buildHttp). buildStdio их не читает, а `authenticated` на строке 521 вычисляется без проверки `t.kind`. RT-009 (runtime.ts:199) при `snap.options.authenticated` сразу возвращает [], и в отчёте не остаётся следа, что правило не сработало.

Выше и ниже по стеку этот случай не обрабатывается. В cli.ts есть UsageError только для обратной комбинации (`--env`/`--cwd` при URL, строка 272). Теста, который фиксировал бы такое поведение как намеренное, нет. test/compat.test.ts:94 передаёт `--stdio` вместе с `--bearer` и `--header` только в режиме `--list-rules`, то есть проверяет лишь то, что опции принимаются, а не семантику. Спецификация (docs/design/spec.md:1025) прямо требует для RT-009 условие «when listing worked without credentials», а stdio-сервер получил листинг без учётных данных. README:73 описывает `--bearer` как «Sent as Authorization: Bearer», что к stdio неприменимо.

Почему severity понижена до low: правило уровня warning, срабатывает только при `--active` и только для stdio-цели. Нужна ещё комбинация с экспортированным токеном или явными `--bearer`/`--header`. Основной сценарий это не ломает и секреты не утекают, но в реальных CI-конфигурациях результат будет неверным (ложный пропуск). Если важен именно CI-сценарий с общим env, оценку можно поднять до medium.
- *repro*: confirmed (conf 0.93) — Подтверждено фактическим прогоном через dist/cli.js (runCli). В src/cli.ts:243 `const bearer = values.bearer ?? env.MCP_REVIEW_CHECK_TOKEN ?? undefined;` вычисляется до ветвления isStdio, а `--header` разбирается тоже без проверки вида цели. Для HTTP `--env`/`--cwd` с stdio-целью отклоняются (cli.ts ~270), обратной проверки нет. Дальше connect.ts:521 ставит `authenticated: !!opts.bearer || Object.keys(opts.headers ?? {}).length > 0` без учёта target.kind, и RT-009 (src/rules/runtime.ts:199) при `snap.options.authenticated` возвращает [] — правило не срабатывает и не помечается как skipped. В stdio bearer никуда не уходит, поэтому пропуск ложный. Сценарий реальный: в CI с экспортированным MCP_REVIEW_CHECK_TOKEN для HTTP-прогона stdio-прогон с --active молча теряет RT-009 (warning) без какого-либо сообщения. Это неверный результат в реальных случаях, но не утечка и не поломка основного сценария, поэтому severity medium.

### F002 [low/bug] Имя заголовка в --header не валидируется: невалидное имя даёт exit 3 «could not connect» вместо usage error

**Where.** `src/cli.ts:137` (reviewer: cli-connect)

**What.** parseHeader (src/cli.ts:137-144, строка актуальна) отвергает только отсутствие ':' и CR/LF; имя не проверяется на соответствие RFC 9110 token. Невалидное имя (например, с пробелом) отвергает undici `Headers.append`, и CLI выдаёт fatal «не удалось подключиться» с exit 3, даже если сервер жив. По spec §3.2 ошибка конфигурации должна давать exit 2. Сам текст диагностики («... is an invalid header name») пользователь видит, так что вред ограничен неверным exit-кодом и классификацией ошибки как сетевого сбоя.

**Evidence.** `node dist/cli.js http://127.0.0.1:9/mcp --header "bad name: x" --format json` -> exit=3, coverage.reason = `Headers.append: "bad name" is an invalid header name.`; --verbose: `[http] discover: POST … -> Headers.append: "bad name" is an invalid header name. (0 ms)`.

**Repro (verifier).**

```
Stub: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/srv.mjs (HTTP 127.0.0.1:18777, отвечает на любой JSON-RPC результатом initialize).
$ node dist/cli.js http://127.0.0.1:18777/mcp --header "bad name: x" --format json -> exit=3; в JSON 'invalid header name' (/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f002b.json)
$ node dist/cli.js http://127.0.0.1:18777/mcp --header "Good: x" --format json -> exit=0
Также с портом 9 (как у автора): exit=3, сообщение 'invalid header name.' (/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f002.json)
```

**Suggested fix.** В parseHeader проверять имя RFC 9110 token: `/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/` и бросать UsageError('--header name must be an HTTP token (the value is not shown)'). Тест на exit 2.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Код проверен: в parseHeader есть только проверка `i <= 0` и регулярка /[\r\n]/, имя не валидируется. Ни выше по стеку (connect.ts), ни в тестах (grep по 'invalid header'/'header name' в test/ ничего не нашёл) нет обработки или признака того, что так задумано. Spec §3.1 (строка 1127) требует для --header только отказ при CR/LF, поэтому формально текущее поведение спеку не нарушает. Но §3.2 относит ошибки usage/config к exit 2, а exit 3 предназначен для недоступного транспорта, так что классификация неверна. Воспроизведено на живом локальном stub-сервере, а не только на закрытом порту 9, как у автора: с `--header "bad name: x"` получаем exit=3 и 'invalid header name' в отчёте, с `--header "Good: x"` против того же сервера exit=0. Значит, исход определяется именем заголовка, а не сетью. Severity понижена до low: ошибка возникает только при опечатке в имени заголовка, и пользователь всё равно видит понятную причину. Страдают только exit-код и рамка «could not connect». Секреты не утекают: undici в сообщении показывает имя, а не значение.
- *repro*: confirmed (conf 0.9) — Проблема воспроизведена на dist/cli.js. В parseHeader нет проверки имени на token-символы. При вызове с --header "bad name: x" CLI завершается с кодом 3, а coverage.reason = `Headers.append: "bad name" is an invalid header name.`. Значит, причина именно в имени заголовка, а не в недоступности порта: та же причина получена и на 127.0.0.1:9, и на 127.0.0.1:18777, где порт уже был занят каким-то процессом. Контроль: --header "badname x" без ':' корректно даёт usage error и exit 2. Spec §3.2 относит ошибки usage/config к exit 2, а exit 3 оставляет для случаев «could not reach the server». Severity снижаю до low: ошибку вызывает только явно некорректный пользовательский ввод, сообщение об ошибке понятное, секретов в выводе нет. Неверен только класс кода выхода.

### F003 [low/bug] URL с userinfo (https://user:pass@host/mcp) принимается, но fetch его отвергает — всегда exit 3 с невнятной причиной

**Where.** `src/cli.ts:267` (reviewer: cli-connect)

**What.** src/cli.ts:262-271 (HTTP-ветка; строка 267 — это `new URL(raw)`, она актуальна) принимает URL с userinfo (`http://user:pass@host/mcp`) и передаёт его как `spec = { kind: 'http', url: raw }`, ничего не делая с учётными данными. Node fetch (undici) отказывается строить такой запрос (TypeError «Request cannot be constructed from a URL that includes credentials») ещё до подключения. Поэтому сервер не получает ни одного запроса, прогон всегда завершается с connect-failed и exit 3, правила о сервере не выполняются. Причина в отчёте приведена (текст TypeError), то есть она не «невнятная», но сформулирована от имени fetch, без подсказки, что делать. Обход есть: `--header "Authorization: Basic …"`. Остальная часть кода (redact.ts/urlSecrets, shownUrl, displayUrl, e2e-тест «the password in user:pass@ is redacted») рассчитана на такой ввод, но e2e-тест проверяет только отсутствие утечки, а не код выхода, поэтому проходит без реальной проверки. Исправление: в cli.ts отвергать userinfo через UsageError с подсказкой про `--header` или переводить его в заголовок Basic с редакцией.

**Evidence.** `node dist/cli.js 'http://user:pass@127.0.0.1:9/mcp' --format json --timeout 3000` -> exit=3, coverage.reason = `Request cannot be constructed from a URL that includes credentials: http://«redacted»:«redacted»@127.0.0.1:9/mcp`. (Порт 9 закрыт, но причина — не ECONNREFUSED, а TypeError до коннекта.)

**Repro (verifier).**

```
S=/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad; cd /home/kali/packages/mcp-review-check && node $S/srv.mjs
=> exit 3 hits 0
{"toolLevel":"connect-failed","reason":"Request cannot be constructed from a URL that includes credentials: http://«redacted»:«redacted»@127.0.0.1:39113/mcp","diagnosis":{"kind":"http","summary":"Request cannot be constructed from a URL that includes credentials: http://«redacted»:«redacted»@127.0.0.1:39113/mcp"}}
node -e "fetch('http://u:p@127.0.0.1:9/').catch(e=>console.log(e.message))"
=> Request cannot be constructed from a URL that includes credentials: http://u:p@127.0.0.1:9/
```

**Suggested fix.** В cli.ts: если `u.username || u.password` — либо UsageError с подсказкой `--header "Authorization: Basic <b64>"`, либо автоматически вырезать userinfo из URL и добавить заголовок Authorization: Basic (с редакцией). Сохранить urlAsEntered для правил.

**Verifier votes.**

- *reader*: confirmed (conf 0.9) — Проверил код и попробовал опровергнуть находку. Не удалось: дефект воспроизводится.

1. **Код.** cli.ts:262-271 проверяет только наличие схемы и протокол http/https. Для userinfo (`u.username` / `u.password`) нет ни проверки, ни преобразования. Ниже по стеку (buildSnapshot / connect) такой случай тоже не обрабатывается: TypeError от fetch просто попадает в coverage.reason.

2. **Тесты.** test/e2e-redaction.test.ts:177-181 запускает CLI с `user:pass@` против echo-сервера, но проверяет только `expectNoLeak` и не проверяет `r.code`. Соседние тесты при этом проверяют `not.toBe(3)`. Значит, тест не показывает, что поведение намеренное: он проходит без реальной проверки, потому что сервер вообще ничего не получает.

3. **Спецификация.** В docs/design/spec.md нет требования отвергать userinfo или поддерживать Basic-аутентификацию через URL. Значит, явного противоречия со спецификацией нет. Но обработка в redact.ts и displayUrl показывает, что такой ввод считается допустимым.

4. **Repro.** Поднял локальный HTTP-сервер со счётчиком запросов. Результат: `node dist/cli.js http://user:pass@127.0.0.1:<port>/mcp --format json --timeout 3000` → exit 3, hits 0. Поле coverage: `{"toolLevel":"connect-failed","reason":"Request cannot be constructed from a URL that includes credentials: http://«redacted»:«redacted»@127.0.0.1:39113/mcp"}`. Отдельно `fetch('http://u:p@127.0.0.1:9/')` → тот же TypeError. Скрипт: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/srv.mjs.

**Почему severity понижена до low.**
- Причина в отчёте всё же названа: текст TypeError прямо упоминает credentials. Формулировка «невнятная причина» в заголовке находки преувеличена.
- Есть обход через `--header Authorization: Basic`.
- Credentials в URL не поддерживаются ни одним из каталогов (см. обоснование AUTH-001), так что это редкий ввод.
- Утечки нет: и URL, и пароль замаскированы.

Это не косметика, потому что основной сценарий для такого ввода полностью ломается. Но ввод нетипичен, поэтому severity между low и medium. Выбрал low.
- *repro*: confirmed (conf 0.9) — Код: в ветке http cli.ts делает только new URL(raw) и проверяет протокол. Затем выполняется spec = { kind: 'http', url: raw }; username и password не проверяются. Репродукция: поднял локальный HTTP-listener на 127.0.0.1:18733, который пишет в лог каждый запрос, и запустил dist/cli.js с http://user:pass@127.0.0.1:18733/mcp. Результат: exit=3, toolLevel=connect-failed, reason — TypeError undici про credentials. Listener не получил ни одного запроса, то есть сбой происходит до коннекта, а не из-за сети. Отдельный вызов fetch с u:p@ даёт ту же ошибку. Утверждение подтверждено по существу. Оценку severity снижаю до low: сообщение об ошибке понятное и редактированное, workaround через --header существует, URL с userinfo для MCP-серверов встречается редко.

### F004 [low/bug] --active-auth, --tool-args, --sarif-location молча принимаются там, где не действуют (например --active-auth при --stdio печатает пугающий DCR-notice)

**Where.** `src/cli.ts:282` (reviewer: cli-connect)

**What.** src/cli.ts не проверяет, сочетаются ли флаги --active-auth, --tool-args и --sarif-location с режимом запуска. --active-auth вместе с --stdio принимается молча, а на stderr при этом выводится Notice о создании DCR-клиента (строка 282), хотя никакой DCR-пробы для stdio не бывает. --tool-args без --active читается и проверяется, но дальше нигде не используется. --sarif-location без --format sarif просто игнорируется. Для обратного случая проверка в том же файле есть: --env/--cwd с <url> дают UsageError (строка 270), так что поведение непоследовательное. Утверждение автора «пользователь думает, что проверки прошли» преувеличено: в отчёте AUTH-019..021 явно помечены как skipped с причиной 'auth probe did not run', а RT-* — с причиной 'needs --active'. Ложного зелёного результата нет. Ошибка в UX/диагностике, результат проверки она не искажает.

**Evidence.** `node dist/cli.js --stdio "node test/fixtures/good-server.mjs" --tool-args $S/ta.json --active-auth --format json` -> exit=0, stderr: `Notice: --active-auth creates a DCR client on your authorization server…`, активных вызовов нет. В cli.ts нет ни одной проверки сочетаний active-auth/stdio, tool-args/active, sarif-location/format.

**Repro (verifier).**

```
S=/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad; echo '{}' > $S/ta.json
node dist/cli.js --stdio "node test/fixtures/good-server.mjs" --tool-args $S/ta.json --active-auth --sarif-location x/y --format json
-> exit=0
stderr:
Notice: --active-auth creates a DCR client on your authorization server and sends bogus /authorize and /token requests.
Local target: deploy-time checks are informational; --no-local for strict checks.
JSON skipped: {"ruleId":"AUTH-019","reason":"auth probe did not run"}, AUTH-020/021 same, {"ruleId":"RT-001","reason":"needs --active"} ...
Ни UsageError, ни предупреждения о неприменимых --tool-args и --sarif-location нет. Вывод сохранён в /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f004.json и /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f004.err
```

**Suggested fix.** UsageError: `--active-auth applies only to <url>`; warning на stderr (или UsageError) `--tool-args has no effect without --active`; warning `--sarif-location applies only to --format sarif`.

**Verifier votes.**

- *reader*: confirmed (conf 0.8) — Номер строки 282 актуален: там Notice выводится без всяких условий, если задан values['active-auth']. Проверок сочетаний active-auth/stdio, tool-args/active и sarif-location/format в cli.ts нет. Есть только --env/--cwd → «apply only to --stdio» (L270), то есть в проекте уже принято отвергать флаги, которые неприменимы к режиму. В docs/design/spec.md:1135 написано: «The CLI prints this notice». Применимость флагов к stdio и URL там не описана, и намеренность молчаливого приёма spec не подтверждает. В README у --sarif-location стоит пометка «SARIF only», но предупреждения в коде нет. Тестов, где молчаливый приём закреплён как намеренный, я не нашёл. test/windows.test.ts и e2e-redaction.test.ts вызывают --stdio с --tool-args, но в первом случае вместе с --active, а второй проверяет ошибку чтения файла. Severity снижаю до low: в отчёте пропущенные правила видны с причинами, поэтому ложного прохождения нет. Остаются лишний пугающий Notice и молча проигнорированные флаги. Это косметика и UX, основной сценарий не ломается.
- *repro*: confirmed (conf 0.85) — Я воспроизвёл проблему на dist/cli.js. Код подтверждает, что в cli.ts нет проверок сочетаний active-auth/stdio, tool-args/active и sarif-location/format. Есть только аналогичная проверка для --env/--cwd (строка 270). Единственный потребитель activeAuth — runAuthProbe в HTTP-ветке. toolArgs используется только внутри блока `if (opts.active)`. Severity я понизил с medium до low. Отчёт не врёт: пропущенные правила честно перечислены в skipped с причинами, а exit 0 соответствует реальному результату проверок. Реальный вред сводится к ложному предупреждению о создании DCR-клиента и к флагам, которые принимаются без эффекта. Это косметика и UX, на основной сценарий не влияет.

### F005 [low/bug] --header "Authorization: …" вместе с --bearer: оба заголовка уходят на сервер и склеиваются в «Bearer A, Bearer B»

**Where.** `src/cli.ts:241` (reviewer: cli-connect)

**What.** headers хранятся с именем как введено (`Authorization`), bearer добавляется как `authorization` (connect.ts:275). Headers в fetch регистронезависимы и объединяют дубликаты через запятую — сервер получает невалидный Authorization и отвечает 401, что CLI трактует как token-rejected. То же для дубликатов `--header X-A --header x-a`.

**Evidence.** `node -e "console.log(new Headers({Authorization:'Bearer A', authorization:'Bearer B'}).get('authorization'))"` -> `Bearer A, Bearer B`. cli.ts:242 `headers[k] = v` без нормализации регистра; connect.ts:275 `authHeaders.authorization = \`Bearer ${opts.bearer}\``.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f005.mjs (http-сервер на 127.0.0.1, отвечает 401 и логирует req.headers.authorization; runCli([url,'--header','Authorization: Bearer AAA','--bearer','BBB','--format','json'])) -> exit 1 auth values seen: [ 'undefined', 'Bearer AAA, Bearer BBB', 'Bearer mcp-review-check-invalid-token' ]
```

**Suggested fix.** Нормализовать имена к lower-case в parseHeader; UsageError, если задан заголовок authorization и `--bearer` одновременно; при повторе имени — последний выигрывает или ошибка.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.9) — parseHeader (cli.ts:137-144) сохраняет имя заголовка как введено, без нормализации регистра; cli.ts:242 `headers[k] = v`. В connect.ts:274-275 authHeaders = {...headers} и затем `authHeaders.authorization = Bearer ...` — получаются два ключа, различающихся регистром. Дальше они уходят в ModernClient (modern.ts:70) и в SDK-транспорт (`requestInit.headers`) и попадают в fetch. При построении Headers из объекта дубликаты склеиваются через запятую. Ни выше, ни ниже по стеку это не обрабатывается. В spec.md:1127/1170 сказано только, что «bearer plus --header values» передаются вместе; конфликт не оговорён и тестов на это намеренное поведение нет. Строка 241 актуальна (объявление headers, присваивание на 242). Репро против локального эхо-сервера подтверждает. Последствие ограничено: это ошибка пользователя (задал два источника токена), а результат — ложный 401 / token-rejected, так что low корректно.

### F006 [low/bug] 401 при --header (API-key/custom auth) без --bearer даёт coverage 'auth-required' / «server requires OAuth» вместо «credentials rejected»

**Where.** `src/connect.ts:314` (reviewer: cli-connect)

**What.** При 401 на connect.ts:314-315 coverage и trigger выбираются только по opts.bearer. Если креды переданы через --header (X-Api-Key или Authorization: Bearer) и сервер их отверг, отчёт показывает 'auth-required' с советом 'pass --bearer <token>' (engine.ts:21) и trigger 'preflight-401' вместо token-rejected/bearer-rejected. Это расходится с options.authenticated (connect.ts:521), где --header уже учитывается.

**Evidence.** connect.ts:314 `snap.coverage = opts.bearer ? { toolLevel: 'token-rejected', … } : { toolLevel: 'auth-required', reason: 'server requires OAuth' }; trigger ??= opts.bearer ? 'bearer-rejected' : 'preflight-401';` — `opts.headers` не учитываются.

**Suggested fix.** Использовать `authenticated = !!opts.bearer || Object.keys(headers).length>0`: при 401 и authenticated -> 'token-rejected' с reason 'supplied credentials rejected (401)'; trigger 'bearer-rejected' переименовать/расширить до 'credentials-rejected'.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — Строка актуальна: src/connect.ts:314-315 выбирает token-rejected/auth-required и trigger только по `opts.bearer`. При этом `--header` действительно попадают в authHeaders (connect.ts:273-275) и уходят в discover и legacy connect, то есть отвергнутые креды из `--header` дают 'auth-required' / 'server requires OAuth', а engine.ts:21 authReason выводит 'server requires auth; pass --bearer <token>'. Это внутренне противоречиво: в том же файле, connect.ts:521, `options.authenticated = !!opts.bearer || Object.keys(opts.headers ?? {}).length > 0`, то есть заголовки уже считаются аутентификацией. Spec (docs/design/spec.md:1263, 1273) задаёт только перечисления trigger/coverage и про --header ничего не говорит. Тест test/e2e-http.test.ts:142 проверяет только путь с --bearer, сценарий с --header не тестируется. Последствие: вводящий в заблуждение текст отчёта и неверная пометка trigger; сами правила работают корректно.

### F008 [low/bug] Несуществующий --cwd даёт «spawn node ENOENT» (выглядит как отсутствие node), exit 3

**Where.** `src/cli.ts:261` (reviewer: cli-connect)

**What.** Node сообщает ENOENT одинаково для отсутствующей команды и для отсутствующего cwd. CLI не проверяет каталог, поэтому пользователь получает fatal «spawn node ENOENT» и exit 3, а не ошибку конфигурации (exit 2) с указанием на --cwd.

**Evidence.** `node dist/cli.js --cwd /nonexistent-dir --stdio "node -e 1" --format json` -> exit=3, coverage: `{ toolLevel: 'connect-failed', reason: 'spawn node ENOENT' }`.

**Repro (verifier).**

```
node dist/cli.js --cwd /nonexistent-dir --stdio "node -e 1" --format json -> exit=3; в JSON: "coverage": {"toolLevel": "connect-failed", "reason": "spawn node ENOENT"}; message: "stdio server did not start: could not start or initialize the stdio server: spawn node ENOENT"; fix: "Check that the command starts and speaks MCP on stdin/stdout ..." (про --cwd ни слова)
```

**Suggested fix.** В cli.ts: `if (values.cwd && !statSync(values.cwd, {throwIfNoEntry:false})?.isDirectory()) throw new UsageError('--cwd is not a directory')`. В buildStdio при ENOENT и заданном cwd дополнять сообщение подсказкой.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.85) — cli.ts:261 передаёт values.cwd в spec без проверки. connect.ts:423/625 вызывают spawn(..., {cwd}); при несуществующем cwd Node выдаёт `spawn <cmd> ENOENT`, то есть ту же ошибку, что и при отсутствующей команде. По спецификации (spec.md:1137) --cwd никак не проверяется. Тестов, которые фиксировали бы такое поведение как намеренное, нет: в test/compat.test.ts:96 используется только '--cwd .'. Подсказка в отчёте («Check that the command starts and speaks MCP…») про cwd ничего не говорит. Уточнение к формулировке: в отчёте поле reason лежит в coverage, а не в fatal, и та же строка повторяется в сообщении находки про Streamable HTTP transport. Это ухудшение DX/диагностики, а не ошибка результата, поэтому low.

### F009 [low/bug] --output "" молча игнорируется: отчёт уходит в stdout

**Where.** `src/cli.ts:327` (reviewer: cli-connect)

**What.** `if (values.output)` трактует пустую строку как «нет опции»; аналогично `color` (строка 309). Пользователь, собравший путь из пустой переменной (`--output "$OUT"`), не получает файла и не видит ошибки.

**Evidence.** `node dist/cli.js --output "" --stdio "node -e 1" --format json` -> stdout 13166 байт, в stderr нет ни ошибки, ни строки «report written to».

**Repro (verifier).**

```
node dist/cli.js --output "" --stdio "node -e 1" --format json -> exit=3, stdout_bytes=13166; stderr содержит только 'Local target: deploy-time checks are informational; --no-local for strict checks.' — ни ошибки, ни 'report written to'
```

**Suggested fix.** `if (values.output !== undefined && !values.output) throw new UsageError('--output needs a file path')`. Дополнительно (DX): до запуска проверять `accessSync(dirname(output), W_OK)` — иначе опечатка в пути обнаруживается после 30–60 с прогона.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — cli.ts:327 `if (values.output)` проверяет истинность значения, поэтому пустая строка ведёт себя как отсутствие опции: отчёт уходит в stdout, ошибки нет, строки «report written to» тоже нет. На строке 309 `!values.output` для color работает так же. spec.md:1131 говорит «When given, the full report goes to the file»; формально --output "" задан, но файла нет, так что поведение со спецификацией расходится. Тестов на пустой --output нет. Ущерб невелик: отчёт не теряется, а оказывается в stdout. Остаётся low.

### F010 [low/bug] `--stdio foo -- node x` даёт нерелевантное «expected a single <url>»

**Where.** `src/cli.ts:215` (reviewer: cli-connect)

**What.** splitStdioArgv (src/protocol/stdioArgs.ts:52-59, а не stdioArgs.ts:233) распознаёт `--` только у «голого» `--stdio`: следующий за ним аргумент должен отсутствовать или начинаться с '-'. При `--stdio foo -- node x` split.command не задаётся, parseArgs превращает хвост после `--` в positionals, проверка на cli.ts:214 не срабатывает, и на cli.ts:215 пользователь получает нерелевантное «expected a single <url>», а не «give --stdio either ... not both».

**Evidence.** `node dist/cli.js --stdio foo -- node x` -> `error: expected a single <url>`; `splitStdioArgv(['--stdio','foo','--','node','x'])` -> `{args:[...всё как есть]}`.

**Repro (verifier).**

```
node dist/cli.js --stdio foo -- node x -> 'error: expected a single <url>\nRun with --help for usage.' exit=2; так же для `node dist/cli.js -- node x --stdio foo` -> 'error: expected a single <url>' exit=2
```

**Suggested fix.** В cli.ts: если `argv.includes('--') && values.stdio !== undefined` -> UsageError 'give --stdio either "<command>" or -- <command> [args...], not both'. Либо в splitStdioArgv возвращать флаг `separator: true`.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.9) — Код подтверждает: в stdioArgs.ts:56 findIndex требует, чтобы --stdio был последним в head или чтобы за ним шёл аргумент с '-'. Тест в test/e2e-stdio.test.ts:177 покрывает только вариант `--stdio 'node x.js' --stdio -- node y.js` и проверяет лишь code 2, без текста; случай с одним --stdio со значением и `--` не покрыт. Exit 2 правильный, неверен только текст сообщения, поэтому low. Строка 215 актуальна. Ссылка в описании на stdioArgs.ts:233 неверна: файл src/protocol/stdioArgs.ts, функция на строке 52.

### F024 [low/bug] Строгое сравнение id в SSE-watcher: ответ с id другого типа заставляет ждать полный timeout на каждый запрос

**Where.** `src/protocol/trace.ts:74` (reviewer: protocol-probe)

**What.** `isResponseTo` сравнивает `m.id === id`. Если сервер (по ошибке) возвращает id строкой `"1"` на числовой запрос, watcher не срабатывает, поток читается до таймаута, затем `parseBody` всё равно находит сообщение через `?? msgs[0]`. Результат корректен, но каждый modern-запрос (listAll, read, пробы) ждёт весь `timeoutMs` (30 с по умолчанию) — run растягивается на минуты.

**Evidence.** Репро с mock SSE, поток не закрывается: `numid took 24 ms; result? true` vs `strid took 1500 ms; result? true error undefined bodyMs 1501` (timeoutMs=1500).

**Repro (verifier).**

```
node против dist/protocol/trace.js, mock SSE, поток не закрывается, timeoutMs=1500, fullBody:
id 1 took 19 ms json? true err undefined
id "1" took 1500 ms json? true err undefined
```

**Suggested fix.** В watcher дополнительно сравнивать `String(m.id) === String(id)` и фиксировать несовпадение типа как ObservedError (SPEC-016 как раз про «ids must echo the request»).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.75) — Строки 74-75 актуальны: isResponseTo использует строгое `m.id === id`, sseResponseWatcher (78-86) поэтому не останавливает чтение, если сервер вернул id строкой "1" на числовой запрос. readBody читает до таймаута, потом parseBody (127-137) находит сообщение через `?? msgs[0]`, так что результат верный, но запрос держится весь timeoutMs. Теста, который закреплял бы такое поведение как намеренное, в test/ нет. SPEC-016 проверяет только observedErrors (ответы-ошибки), т.е. на успешных ответах несовпадение id не попадает даже в отчёт. Срабатывает только при двух условиях сразу: сервер нарушает JSON-RPC (id не того типа) и держит SSE-поток открытым. Поэтому severity low.

### F027 [low/bug] isNonPublicIPv6 не распознаёт несжатые/hex-формы loopback и mapped-адресов, multicast и documentation-префикс

**Where.** `src/rules/util/net.ts:24` (reviewer: protocol-probe)

**What.** isNonPublicIPv6/isLoopbackHost распознают IPv4-mapped адрес только в dotted-форме (::ffff:a.b.c.d), хотя spec §1.5 заявляет покрытие IPv4-mapped. Все хосты, взятые из URL (auth.ts:37 httpsOrLocal, apps.ts:141/143), WHATWG URL уже нормализовал в hex-форму (::ffff:7f00:1, ::ffff:a00:1), поэтому для них ветка mapped не срабатывает: http://[::ffff:10.0.0.1] в CSP не помечается как private IP, а http://[::ffff:127.0.0.1] получает 'uses http://' и в local mode не считается локальным. Несжатая форма 0:0:0:0:0:0:0:1 на этих путях не встречается (URL сжимает её до ::1). Отсутствие ff00::/8, 2001:db8::/32 и подобных — пробел в покрытии относительно IPv4-списка, а не нарушение spec. Исправление: разворачивать ::ffff:XXXX:YYYY в IPv4 перед проверкой (в т.ч. в isLoopbackHost); по желанию добавить ff00::/8 и 2001:db8::/32 вместе со spec.

**Evidence.** node против dist: `0:0:0:0:0:0:0:1 false`, `::ffff:7f00:1 false`, `ff02::1 false`, `2001:db8::1 false`, `isLoopbackHost('0:0:0:0:0:0:0:1') false`, `isLoopbackHost('::ffff:127.0.0.1') false` (при этом `::ffff:127.0.0.1 true`, `fd00::1 true`).

**Repro (verifier).**

```
node --input-type=module против dist/rules/util/net.js:
0:0:0:0:0:0:0:1 false
::ffff:7f00:1 false
::ffff:a00:1 false
ff02::1 false
2001:db8::1 false
::ffff:127.0.0.1 true
fd00::1 true
lb 0:..:1 false lb ::ffff:127.0.0.1 false
http://[::ffff:127.0.0.1]/cb -> [::ffff:7f00:1] loopback false nonpublic false
http://[0:0:0:0:0:0:0:1]/ -> [::1] loopback true nonpublic true
http://[::ffff:10.0.0.1]/ -> [::ffff:a00:1] loopback false nonpublic false
```

**Suggested fix.** Нормализовать адрес через `new URL(`http://[${ip}]`).hostname` или ручное разворачивание в 8 hextet'ов, затем сравнивать по префиксам (включая `::ffff:0:0/96` → проверка IPv4-части, `ff00::/8`, `2001:db8::/32`). Использовать ту же нормализацию в isLoopbackHost.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — Строка 24 (isNonPublicIPv6) и строка 44 (isLoopbackHost) актуальны. spec.md §1.5 (строка 90) прямо обещает покрытие '::1, fc00::/7, fe80::/10, and IPv4-mapped addresses', а реализация распознаёт mapped-адрес только в dotted-форме (/^::ffff:(\d+\.\d+\.\d+\.\d+)$/). Проблема достижима на практике: WHATWG URL нормализует `[::ffff:127.0.0.1]` в `[::ffff:7f00:1]`, а все вызовы с хостами из URL (src/rules/auth.ts:37 httpsOrLocal, src/rules/apps.ts:141/143 проверки CSP/domain) получают u.hostname, то есть hex-форму. Поэтому ветка mapped для этих путей фактически мёртвая: `http://[::ffff:10.0.0.1]` в CSP-поле не помечается как private IP, а `http://[::ffff:127.0.0.1]` помечается как 'uses http://'. Тест test/util.test.ts:61 проверяет только dotted-форму '::ffff:10.0.0.1', так что намеренности тут нет. Часть утверждения при этом переоценена. (1) Несжатая форма `0:0:0:0:0:0:0:1` на практике не встречается: URL нормализует её в `[::1]` (repro: loopback true), а DNS-резолвер возвращает сжатую форму. Остаётся только прямой вызов функции, а в коде такого нет. (2) ff00::/8, 2001:db8::/32, 64:ff9b::/96 и 2002::/16 в spec §1.5 для IPv6 не заявлены, так что это расхождение по полноте покрытия (у IPv4 есть 224/4 и 192.0.2/24), а не нарушение spec. (3) Про localMode/SRV-004: isLocalTarget работает по адресам из DNS, и для mapped-AAAA форма зависит от резолвера; это не проверялось, поэтому влияние на SRV-004 не подтверждено. Severity low: последствия — лишний или пропущенный warning для экзотических IPv4-mapped литералов в URL, на безопасность это не влияет.

### F028 [low/bug] parseSseMessages не поддерживает CR-only разделители строк из спецификации SSE

**Where.** `src/protocol/trace.ts:66` (reviewer: protocol-probe)

**What.** SSE допускает `\r\n`, `\n` и одиночный `\r` как конец строки. Парсер делит по `/\r?\n\r?\n/` и `/\r?\n/`, поэтому поток с CR-only терминаторами не распарсится (ни одного сообщения).

**Evidence.** `parseSseMessages('data: {"a":1}\r\rdata: {"b":2}\r\r')` → `[]`.

**Repro (verifier).**

```
node: parseSseMessages('data: {"a":1}\r\rdata: {"b":2}\r\r') -> CR-only: []
```

**Suggested fix.** Нормализовать `text.replace(/\r\n?/g, '\n')` перед разбором (и в sseResponseWatcher — с учётом границы чанка).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.6) — Строки 66-67 актуальны: блоки делятся по /\r?\n\r?\n/, строки по /\r?\n/. По спецификации WHATWG SSE одиночный CR тоже считается концом строки, а парсер его не понимает и не находит ни одного сообщения. SDK (eventsource-parser) CR-only разбирает, так что SDK и пробы/watcher увидят поток по-разному. Отклонение от спецификации реальное, но серверов с CR-only терминаторами на практике почти нет, поэтому severity low. Тестов на CR-only в test/ нет.

### F039 [low/bug] SPEC-018: зарезервированные префиксы `modelcontextprotocol.io/`, `mcp.dev/`, `mcp/` не обнаруживаются

**Where.** `src/rules/spec.ts:441` (reviewer: rules-server-spec-auth)

**What.** metaKeyProblem (src/rules/spec.ts:441, строка актуальна) считает префикс зарезервированным только когда `modelcontextprotocol`/`mcp` стоит во втором лейбле (`labels[1]`). В тексте MCP spec о `_meta` сказано: «Any prefix beginning with zero or more valid labels, followed by modelcontextprotocol or mcp, followed by any valid label, is reserved». Примеры оттуда же: `modelcontextprotocol.io/`, `mcp.dev/`, `api.modelcontextprotocol.org/`, `tools.mcp.com/`. Поэтому SPEC-018 не видит ключи, где этот лейбл стоит первым (`modelcontextprotocol.io/x`, `mcp.dev/x`) или третьим и дальше (`a.b.mcp.com/x`). Это ложные отрицания: rule молчит там, где должен выдать warning. Сужение записано и в docs/design/spec.md:372 («second label»). Значит, дизайн-документ расходится со спецификацией, а не делает исключение сознательно. В тестах проверяются только `dev.mcp/thing` и `io.modelcontextprotocol/*`, случая с первым лейблом нет. В исправлении `labels.some(...)` из находки нужно сохранить исключения: META_ALLOW, `mcp/www_authenticate` и info-уровень для `io.modelcontextprotocol/*`. Однолейбловый `mcp/x` по буквальной формулировке spec не зарезервирован: после `mcp` нет лейбла. Решение по нему стоит принять отдельно.

**Evidence.** node против dist: `metaKeyProblem('modelcontextprotocol.io/x') -> undefined`, `metaKeyProblem('mcp.dev/x') -> undefined`, `metaKeyProblem('mcp/x') -> undefined`, при этом `api.modelcontextprotocol.org/x -> 'reserved prefix'`. Код: `if ((labels[1] === 'modelcontextprotocol' || labels[1] === 'mcp') && !META_ALLOW.has(key)) return 'reserved prefix';`

**Repro (verifier).**

```
cd /home/kali/packages/mcp-review-check && node -e "import('./dist/rules/spec.js').then(m=>{for(const k of ['modelcontextprotocol.io/x','mcp.dev/x','tools.mcp.com/x','api.modelcontextprotocol.org/x','dev.mcp/x','mcp/x','com.example/x'])console.log(k,'->',m.metaKeyProblem(k))})"
Вывод:
modelcontextprotocol.io/x -> undefined
mcp.dev/x -> undefined
tools.mcp.com/x -> reserved prefix
api.modelcontextprotocol.org/x -> reserved prefix
dev.mcp/x -> reserved prefix
mcp/x -> undefined
com.example/x -> undefined
```

**Suggested fix.** `const reserved = labels.some((l) => l === 'modelcontextprotocol' || l === 'mcp');` (любой лейбл префикса), с сохранением META_ALLOW и info для `io.modelcontextprotocol/*`. Обновить docs/design/spec.md:372 и добавить в test/rules/spec.test.ts примеры из spec. Без сети формулировку schema.ts подтвердить не смог — confidence ниже 0.9.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Код, на который ссылается находка, совпадает со строкой 441: проверяется только labels[1]. Ни выше, ни ниже по стеку это не компенсируется. SPEC_018 вызывает metaKeyProblem напрямую и меняет только severity для io.modelcontextprotocol/. В тестах (test/rules/spec.test.ts:153-159, 133-135) нет кейса, который делал бы пропуск modelcontextprotocol.io/ или mcp.dev/ намеренным. docs/design/spec.md:372 повторяет ту же узкую формулировку («second label»), то есть ошибка общая для документа и кода. Обе опираются на schema.ts/spec как источник (sources: [SCHEMA_TS]), а там зарезервирован любой лейбл, за которым идёт ещё один, и приведены как раз примеры modelcontextprotocol.io/ и mcp.dev/. Текст spec я сверял по памяти, локальной копии schema.ts с этой фразой нет, поэтому confidence меньше 0.9. Severity снижаю до low: речь только о том, что линтер пропускает предупреждение. Реальные серверы редко используют ключи вида modelcontextprotocol.io/* или mcp.dev/*. Основной сценарий это не ломает, и с безопасностью не связано.
- *repro*: confirmed (conf 0.75) — Воспроизвёл через node-скрипт против dist/rules/spec.js. Для `modelcontextprotocol.io/x`, `mcp.dev/x` и `a.b.mcp.com/x` функция возвращает undefined, а для `api.modelcontextprotocol.org/x` и `tools.mcp.com/x` — 'reserved prefix'. Это совпадает с кодом в строке 441: проверяется только labels[1]. Текст spec о `_meta` в node_modules не найден, без сети его не сверить. Формулировку и примеры из находки (`modelcontextprotocol.io/`, `mcp.dev/`, `api.modelcontextprotocol.org/`, `tools.mcp.com/`) сверил по памяти о спецификации 2025-06-18, они совпадают. Поэтому confidence снижен. По той же формулировке после mcp/modelcontextprotocol должен идти ещё один лейбл, значит однолейбловые `mcp/x` и `modelcontextprotocol/x` не зарезервированы, и в этой части находка ошибочна. Severity снижена до low: правило уровня warning, ложноотрицательный результат на нетипичных префиксах.

### F040 [low/bug] SPEC-016: флаг `modern` берётся из заголовка НАШЕГО запроса, а не из эры сервера — legacy-сервер получает ошибку про «2026-07-28 response»

**Where.** `src/rules/spec.ts:363` (reviewer: rules-server-spec-auth)

**What.** SPEC-016 (src/rules/spec.ts:363, строка актуальна) выбирает политику кодов по `e.modern ?? snap.era === 'modern'`. `collectErrors` (src/connect.ts) ставит `modern: true` по заголовку `mcp-protocol-version: 2026-07-28` НАШЕГО запроса. Проба `discover` (ModernClient, src/protocol/modern.ts) уходит каждому HTTP-серверу. Поэтому legacy-сервер (era=legacy/sse-legacy), который ответил на неизвестный server/discover или на незнакомую версию кодом из -32020..-32099 (кроме -32020/-32021/-32022) либо кодом -32002/-32042, получает spec error «2026-07-28 response uses code … / … is in the reserved range». Комментарий в самом правиле и docs/design/spec.md говорят обратное: в 2025-11-25 этот диапазон определяет реализация, и legacy-серверы проверяются только на целочисленный код и id. На практике случай редкий: legacy-SDK обычно отвечают -32601 или -32000, а они вне диапазона. Отсюда severity low. Исправление: учитывать эру сервера, например `const modernPath = e.modern === true && (snap.era === 'modern' || snap.era === 'dual')`, или `e.modern ?? …` с пропуском диапазонных проверок при era legacy/sse-legacy.

**Evidence.** Репро на dist: era='legacy', observedErrors=[{source:'discover', code:-32050, modern:true}] -> `error [spec] discover: error code -32050 is in the reserved range`. Код: `const modernPath = e.modern ?? snap.era === 'modern';`

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f040.mjs (emptySnapshot из dist/snapshot.js; s.era='legacy'; observedErrors=[{source:'discover',requestId:1,responseId:1,code:-32050,modern:true}]; SPEC_016.check(s)) -> [{"message":"discover: error code -32050 is in the reserved range"}]
```

**Suggested fix.** `const modernPath = !!e.modern && isModern(snap);` (ответ на 2026-07-28-запрос и сервер действительно поддерживает 2026-07-28), либо для `era` legacy/sse-legacy пропускать политику диапазонов целиком.

**Verifier votes.**

- *reader*: confirmed (conf 0.65) — Проверил код. В src/rules/spec.ts:363 стоит `const modernPath = e.modern ?? snap.era === 'modern';`. Флаг `e.modern` выставляется только в collectErrors (src/connect.ts) по заголовку mcp-protocol-version запроса. ModernClient всегда шлёт MODERN_VERSION, а `modern.request('server/discover', …, {label:'discover'})` вызывается в buildHttp до определения эры, то есть для любого HTTP-сервера. Если код ошибки не входит в MODERN_CODES (discSignal=false), сервер определяется как legacy, но ошибка discover уже записана с modern:true и проверяется по политике 2026-07-28.

Попытки опровергнуть. (1) Выше по стеку случай не обрабатывается: правило не смотрит на snap.era, если e.modern задан. (2) Тест test/rules/spec.test.ts:115 покрывает только legacy-ошибки без поля modern. Тест :73 с modern:true не задаёт era legacy, поэтому поведение «legacy-сервер + modern-запрос» тестами как намеренное не закреплено. (3) docs/design/spec.md:356 буквально велит смотреть на `observedError.modern`, то есть на ответы на запросы 2026-07-28. В этом смысле реализация следует букве дизайна. Но там же обоснование: «2025-11-25 … predates the range policy, so legacy responses get only the integer and id checks». Сервер, не поддерживающий 2026-07-28, этой политикой не связан, так что вывод «error [spec]» для него — ложное срабатывание, противоречащее замыслу правила. Именно из-за этого буквального соответствия дизайну уверенность умеренная (0.65), а не высокая.

Severity понижаю до low: legacy-реализации обычно отвечают на неизвестный метод или версию кодом -32601 или -32000, вне проверяемого диапазона. Ложное срабатывание возникает только при нестандартных кодах в -32020..-32099 или -32002/-32042.
- *repro*: confirmed (conf 0.8) — Код подтверждает находку. В collectErrors `modern` вычисляется как `requestHeaders['mcp-protocol-version'] === MODERN_VERSION`, а ModernClient (src/protocol/modern.ts:54,73) по умолчанию ставит этот заголовок на discover. Значение `e.modern` при этом определено (true), поэтому в выражении `??` запасной вариант `snap.era` не используется. Скрипт на dist с era='legacy' воспроизвёл обе ложные ошибки. Severity снижаю до low: нужен legacy-сервер, который на неизвестный server/discover отвечает кодом из -32020..-32099 или -32002/-32042. Это допустимо, но встречается редко, а частые коды (-32601, -32600, -32000, -32001) под проверку не попадают. Без живого сервера не проверено, отправляет ли SDK такие коды на практике.

### F042 [low/bug] AUTH-012: при CIMD без "none" и без DCR выдаются два противоречивых claude-warning

**Where.** `src/rules/auth.ts:346` (reviewer: rules-server-spec-auth)

**What.** AUTH-012 (src/rules/auth.ts:344 и :346, номера строк актуальны). Если CIMD объявлен, метода "none" нет и registration_endpoint нет, для claude выдаются два warning. Первое сообщение («CIMD ignored, falls back to DCR») фактически неверно: DCR у сервера нет, переходить не на что. Второе («neither CIMD nor DCR») по сути верно, потому что CIMD без "none" Claude не использует, но формулировка не объясняет, что CIMD объявлен и не принят. Противоречие только в тексте: вердикт (claude warning) правильный, ложного pass/fail или blocker нет. Достаточно, чтобы строка 344 упоминала DCR только при dcr=true, или объединить два сообщения в одно.

**Evidence.** Репро: `client_id_metadata_document_supported:true, token_endpoint_auth_methods_supported:['client_secret_basic']`, без registration_endpoint -> `warning [claude] CIMD advertised without token auth method "none": CIMD ignored, falls back to DCR` + `warning [claude] neither CIMD nor DCR: Claude requires Anthropic-held credentials ...`.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f042.mjs  (вызывает AUTH_012.check из dist/rules/auth.js; snap.authProbe.as[0].json = {client_id_metadata_document_supported:true, token_endpoint_auth_methods_supported:['client_secret_basic']}, без registration_endpoint)
Вывод:
- {platforms:[claude], severity:warning, message:'CIMD advertised without token auth method "none": CIMD ignored, falls back to DCR'}
- {platforms:[claude], severity:warning, message:'neither CIMD nor DCR: Claude requires Anthropic-held credentials (contact mcp-review@anthropic.com) or connection-time credentials; the linter cannot see whether pre-registration is in place'}
- {platforms:[chatgpt], message:'CIMD advertised without "none" or "private_key_jwt"'}
```

**Suggested fix.** Разветвить: `if (cimd && !none) message = dcr ? 'CIMD ignored, falls back to DCR' : 'CIMD advertised without "none" and no DCR: add "none" to token_endpoint_auth_methods_supported or pre-register credentials'`; строку 346 выполнять только при `!cimd`.

**Verifier votes.**

- *reader*: confirmed (conf 0.8) — Сначала пытался опровергнуть. (1) Строки 344 и 346 в src/rules/auth.ts совпадают с указанными в находке. (2) Условия независимы: `cimd && !none` и `!(cimd && none) && !dcr`. При cimd=true, none=false, dcr=false истинны оба, и ни выше, ни ниже по стеку их никто не объединяет. forEachAs только проставляет платформы и суффикс номера AS. (3) docs/design/spec.md:909-920 описывает оба случая для Claude отдельно, про их пересечение не сказано ничего. Значит, такое поведение не задокументировано как намеренное. Но и требования выводить одно сообщение в спеке нет. (4) Тесты: test/rules/auth.test.ts:183 проверяет только, что «CIMD ignored» встречается (через some), test/rules/auth.test.ts:178 проверяет случай без CIMD. Ни один тест не закрепляет двойной вывод как намеренный и не запрещает его. Итог: двойной вывод есть, а противоречие в основном в тексте. «falls back to DCR» вводит в заблуждение, когда DCR нет. «neither CIMD nor DCR» по сути верно, потому что CIMD без "none" для Claude не работает. Severity и платформы корректны, и на прохождение каталога находка не влияет. Поэтому снижаю severity с medium до low: это текст сообщений, результат проверки от него не меняется.
- *repro*: confirmed (conf 0.85) — Проверил по коду: строка 344 срабатывает при `cimd && !none` без проверки dcr. Строка 346 срабатывает при `!(cimd && none) && !dcr`, это условие при cimd=true и none=false истинно. Значит, на входе из failure_scenario оба сообщения выдаются обязательно. Воспроизвёл через dist/rules/auth.js и получил ровно две claude-находки, описанные в F042. Severity снижаю до low. Оба сообщения имеют уровень warning и корректно сообщают, что регистрация клиента для Claude не настроена, то есть вердикт и уровень верны. Ошибка в формулировках: «falls back to DCR» без DCR и «neither CIMD» при объявленном CIMD. Пользователь получает противоречивый текст, но неверного результата проверки нет.

### F043 [low/bug] AUTH-010: self-signed локальный AS в local mode остаётся error на всех платформах, тогда как SRV-001 для того же сертификата даёт Deploy-time info

**Where.** `src/rules/auth.ts:305` (reviewer: rules-server-spec-auth)

**What.** AUTH-010 (src/rules/auth.ts:290-310) в local mode не понижает TLS-сбой AS с role:'as' на loopback/private/dotless хосте. Получается error, тогда как тот же AS по http в local mode проходит без находок (httpsOrLocal), а SRV-001 для MCP-хоста понижает такой же сбой до info «Deploy-time check:». Это расходится с README («deploy-time checks (HTTPS…) are reported as info», FAQ «Is HTTPS a problem? No»), но не с буквой spec §1.4, где список закрыт: это пробел в замысле. Тезис «BLOCKED из-за AUTH-010» преувеличен. Без NODE_EXTRA_CA_CERTS fetch метаданных к self-signed AS тоже падает, и AUTH-007 выдаёт непониженный error. AUTH-010 оказывается единственным блокером лишь тогда, когда fetch доверяет сертификату, а tls.connect(rejectUnauthorized:true) нет (например, при NODE_TLS_REJECT_UNAUTHORIZED=0). Исправление должно охватить AUTH-010 и AUTH-007 (TLS-причина для локального AS) и обновить §1.4 и local-баннер.

**Evidence.** Репро: localMode=true, tls=[{host:'localhost:4000', role:'as', ok:false, code:'DEPTH_ZERO_SELF_SIGNED_CERT'}] -> `error [claude,chatgpt,spec] TLS handshake with localhost:4000 failed`; SRV-001 с тем же кодом на localhost:3000 -> `info [claude,chatgpt] Deploy-time check: ...`.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f043arb/r.mjs (импорт AUTH_010/SRV_001 из dist/rules/). Вывод:
A AUTH-010 [["default","TLS handshake with localhost:4000 failed: DEPTH_ZERO_SELF_SIGNED_CERT"]]
B AUTH-010 []   (тот же AS по http)
C SRV-001 [["info","Deploy-time check: TLS handshake with localhost:3000 failed: DEPTH_ZERO_SELF_SIGNED_CERT; hosts reject this certificate"]]
D AUTH-010 [["default","TLS handshake with keycloak:8443 failed: SELF_SIGNED_CERT_IN_CHAIN"]]
E AUTH-010 strict (localMode=false) — то же, что A.
"default" означает severity правила, то есть error для claude/chatgpt/spec.
```

**Suggested fix.** В AUTH-010 для `t.role==='as'` при `snap.localMode && (isLoopbackHost(hostname) || isNonPublicIp(hostname) || dotless)` понижать до info с префиксом DEPLOY (экспортировать `localize`/DEPLOY из server.ts в util). Упомянуть AUTH-010 в §1.4 и в local-баннере.

**Verifier votes.**

- *reader*: REFUTED (conf 0.65) — Описанное поведение в коде действительно есть, но так и задумано по спецификации, поэтому это не баг.

Что подтверждается. В src/rules/auth.ts:283-313 (AUTH_010, строка 305 актуальна) TLS-сбой с role 'as' всегда даёт error без учёта localMode. Пробы реально выполняются: src/connect.ts:322 пушит {role:'as'} для каждого tlsHosts. SRV-001 (src/rules/server.ts:18-46) понижает такой сбой через localize() до info с префиксом "Deploy-time check: ". Расхождение между SRV-001 и AUTH-010 для self-signed сертификата на localhost воспроизводится по коду.

Почему это не дефект:
1) docs/design/spec.md §1.4 (стр. 60-65) явно и закрыто перечисляет правила, которые понижаются в local mode: «SRV-001, SRV-004 and SRV-005 are downgraded to info». AUTH-010 в списке нет. Фраза про «стену ошибок» описывает мотив, а не обязательство понижать всё подряд.
2) Спека AUTH-010 (spec.md:897-903) прямо требует error, если tls.connect(...rejectUnauthorized) падает с DEPTH_ZERO_SELF_SIGNED_CERT / SELF_SIGNED_CERT_IN_CHAIN, «for the MCP host or any distinct endpoint host». Единственное local-исключение относится к не-https схеме («a loopback AS when the target is local»). Код реализует ровно это: httpsOrLocal, auth.ts:33-42.
3) Тесты в test/rules/auth.test.ts:257-273 закрепляют local-исключение только для http-схемы и проверяют error при TLS-сбоях (стр. 220-223). Теста, который ожидал бы понижения TLS-ошибки AS в local mode, нет.

Итог: находка расходится с текущей спекой и по сути является предложением изменить дизайн (добавить AUTH-010 в §1.4 и экспортировать localize/DEPLOY). Это не ошибка реализации.

Замечание для владельца спеки: есть реальная, хотя и задокументированная, несогласованность. Локальный AS по http проходит без находок, а тот же AS по https с self-signed сертификатом получает BLOCKED. Это повод рассмотреть изменение spec §1.4 как enhancement. Repro не запускался: поведение однозначно следует из кода и спеки.
- *repro*: confirmed (conf 0.8) — Прочитал код AUTH-010. В цикле по snap.transport.tls, если запись не transient и это не сетевой E*-код, в out добавляется { message: 'TLS handshake ... failed' } без severity. Значит, применяется дефолтный error на всех платформах, а проверки snap.localMode в этой ветке нет. В server.ts SRV-001 оборачивает ту же ситуацию в localize(), и в local mode получается info + DEPLOY. Кроме того, httpsOrLocal() в том же auth.ts явно освобождает http-AS на локальном хосте в local mode (это покрыто тестами auth.test.ts:257-273). Поэтому self-signed https для того же хоста остаётся строже, чем голый http, и это нелогично. Спека §1.4 AUTH-010 не упоминает, так что формально это расширение замысла («lint до деплоя без стены ошибок»), отсюда medium, а не high: workaround (поднять AS по http) существует, но вердикт BLOCKED для типичного локального стека неверен. Воспроизведено одиночным vitest-файлом в scratchpad: он переиспользует authSnap из test/rules/auth.test.ts и test/helpers.js, сети нет, проект не менялся.
- *ARBITER (round 2)*: confirmed (conf 0.8) — [partially-confirmed] Сам механизм подтверждён. В AUTH-010 (src/rules/auth.ts:290-310) цикл по snap.transport.tls для role:'as' не смотрит на snap.localMode, поэтому TLS-сбой даёт severity по умолчанию, то есть error для claude/chatgpt/spec. SRV-001 (src/rules/server.ts:18-46) ту же ситуацию на MCP-хосте пропускает через localize() и получает info с префиксом DEPLOY.

Репро через node на dist/rules/{auth,server}.js, скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f043arb/r.mjs:
- A: localMode, AS https://localhost:4000, DEPTH_ZERO_SELF_SIGNED_CERT → AUTH-010 default (error).
- B: тот же AS по http → [] (нет находок).
- C: SRV-001, MCP-хост с тем же кодом → info «Deploy-time check: …».
- D: AS https://keycloak:8443, SELF_SIGNED_CERT_IN_CHAIN → error.
- E: localMode=false → error, как и A.
Значит, сама по себе local mode на поведение AUTH-010 при TLS-сбое не влияет.

Аргументы стороны «refuted» (reader). Буква spec §1.4 действительно перечисляет закрытый список (SRV-001/004/005), а спека AUTH-010 требует error при self-signed. Это верно. Но довод «так задумано» слабее, чем кажется, по трём причинам:
1) Та же спека AUTH-010 требует error и «for the MCP host». Реализация намеренно отдала MCP-хост в SRV-001, где ошибка понижается (комментарий «The MCP host's own certificate is SRV-001»). Буква спеки и так не соблюдается дословно, и выбор сделан в пользу локализации.
2) Спека AUTH-010 сама вводит local-исключение для AS («a loopback AS when the target is local»), а код расширил его на private/dotless хосты. Замысел «локальный AS в local mode не блокирует» в правиле уже заложен, а TLS-ветка из него выпадает.
3) Пользовательский контракт в README шире §1.4. Строка 162: «deploy-time checks (HTTPS, public DNS, tunnel domains) are reported as info». FAQ, строка 288: «Is HTTPS a problem? No». Доверенность сертификата локального AS — это ровно deploy-time HTTPS-проверка. Поэтому «не баг, а дизайн» верно только относительно spec.md, но не относительно README.

Аргументы стороны «confirmed» (repro). Непоследовательность реальна и воспроизведена: http-AS проходит молча, https-AS с self-signed даёт error. Однако утверждение, что «типичный dev-стек получает BLOCKED из-за AUTH-010», преувеличено, а предложенный fix неполон:
- src/probe/auth.ts:124-146 берёт TLS-хосты AS в том числе из issuer PRM, даже если метаданные AS не получены. Без NODE_EXTRA_CA_CERTS сам fetch метаданных к self-signed AS тоже падает. Тогда AUTH-007 (auth.ts:219-231) выдаёт error «no authorization server metadata», а он в local mode тоже не понижается. В типичном сценарии BLOCKED остаётся и после правки одного AUTH-010.
- Обычный dev-путь с mkcert и NODE_EXTRA_CA_CERTS проходит TLS-проверку целиком. Остаётся только info-нота AUTH-010 про NODE_EXTRA_CA_CERTS.
- AUTH-010 становится единственным блокером, только когда fetch доверяет сертификату, а tls.connect с явным rejectUnauthorized:true (src/probe/network.ts:62) — нет. Пример: NODE_TLS_REJECT_UNAUTHORIZED=0. Это узкий сценарий.

Итог. Верно: AUTH-010 в local mode не понижает TLS-сбой локального AS. Это расходится с README-контрактом local mode и с собственным http-исключением правила. Неверно или преувеличено: (а) что это нарушение spec.md, так как это пробел в §1.4; (б) что ложный BLOCKED вызывает именно AUTH-010 и что его правки достаточно. Нужна согласованная правка AUTH-010 и AUTH-007 (сбой метаданных локального AS из-за TLS-кода) плюс обновление §1.4. Severity low: затронут только local mode с self-signed AS, есть обходной путь через NODE_EXTRA_CA_CERTS/mkcert, а при strict-проверке перед деплоем (--no-local или публичный хост) поведение корректно. Пункт про C004 (Windows npx/.cmd) к F043 не относится, и в этом арбитраже он не рассматривался.

### F045 [low/bug] AUTH-015 игнорирует DPoP-challenge, хотя AUTH-002/AUTH-013 принимают схему dpop

**Where.** `src/rules/auth.ts:406` (reviewer: rules-server-spec-auth)

**What.** `a.challenge?.parsed.find((c) => c.scheme === 'bearer')` — для `WWW-Authenticate: DPoP resource_metadata=..., scope="a b"` правило считает, что scope отсутствует, и печатает «401 has no scope=; Claude will request: (no scope)», хотя scope объявлен. Несогласованно с AUTH-002 (`bearer || dpop`) и AUTH-013.

**Evidence.** Репро с challenge `DPoP resource_metadata="...", scope="a b"` -> `info [claude] 401 has no scope=; Claude will request: (no scope)`.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r.mjs -> F045 [{"platforms":["claude"],"message":"401 has no scope=; Claude will request: (no scope)"}] (challenge: DPoP resource_metadata="https://x.example/...", scope="a b"; prm {json:{}})
```

**Suggested fix.** Использовать тот же предикат `c.scheme === 'bearer' || c.scheme === 'dpop'` (вынести в util/wwwAuth.ts `isBearerLike`).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.85) — Строка 406 актуальна: в AUTH_015 стоит `a.challenge?.parsed.find((c) => c.scheme === 'bearer')`. Схему DPoP принимают и AUTH-002 (стр. 71), и AUTH-013 (стр. 369), и сам probe src/probe/auth.ts:73. docs/design/spec.md:842 тоже прямо приравнивает DPoP к Bearer. В test/ нет ни одного теста с DPoP, так что намеренным такое поведение не выглядит. При challenge вида `DPoP ..., scope="a b"` правило ложно сообщает, что scope= нет. Ущерб небольшой: это info-финдинг только для claude. Но если PRM scopes_supported широкий, правило может ещё и выдать ложный warning «requested scope set is broad».

### F061 [low/docs-mismatch] AUTH-002: design §2.8 обещает «chatgpt and spec error» при legacy discovery, код даёт spec=warning

**Where.** `src/rules/auth.ts:80` (reviewer: rules-server-spec-auth)

**What.** В `missing()` финдинг `{ platforms: ['chatgpt','spec'], message }` без явной severity наследует rule.severity (spec: 'warning'). docs/design/spec.md (AUTH-002, строка «no PRM, but legacy origin AS metadata exists → chatgpt and spec error») расходится с фактом. Аналогичная формулировка у AUTH-004 («chatgpt and spec stay errors») — там rule.severity spec=error, совпадает.

**Evidence.** Репро legacyDiscovery: `['Bearer challenge has no resource_metadata parameter', { chatgpt: 'error', spec: 'warning' }]`.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r.mjs -> F061 [["Bearer challenge has no resource_metadata parameter",{"chatgpt":"error","spec":"warning"}],["...; Claude falls back to legacy origin discovery, which is deprecated",{"claude":"warning"}]]
```

**Suggested fix.** Либо задать `severity: 'error'` для этого финдинга (если считать RFC 9728 §5.1 MUST), либо поправить формулировку в docs/design/spec.md.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.9) — Строки 80-81 актуальны: финдинг `{ platforms: ['chatgpt','spec'], message }` создаётся без severity. Движок (dist/rules/engine.js, runRules) в таком случае ставит каждой платформе severity правила, поэтому spec получает 'warning' (у правила spec=warning). А docs/design/spec.md:844 говорит «chatgpt and spec error». Тест test/rules/auth.test.ts:157 назван «chatgpt/spec errors», но проверяет только chatgpt. Итоговая severity финдинга — максимум по платформам, то есть error, поэтому расхождение для spec тест не ловит. Рядом на стр. 859 в AUTH-004 сказано «chatgpt and spec stay errors», и там у правила spec=error, всё совпадает. Расхождение между документацией и кодом подтверждено.

### F066 [low/bug] TOOL-021: для узла без `type` (например `{ $ref, 'x-mcp-header' }`) сообщение «x-mcp-header on a undefined property»

**Where.** `src/rules/schema.ts:224` (reviewer: rules-tools-schema)

**What.** TOOL-021 (src/rules/schema.ts:224): если у узла с x-mcp-header нет собственного `type`, `JSON.stringify(undefined)` даёт в сообщении текст «x-mcp-header on a undefined property». Так бывает и у узла без type, и у узла `{ $ref, 'x-mcp-header' }`. Утверждение о двух сообщениях неверно: правило (d) для `/properties/h` с `$ref` НЕ срабатывает, потому что сам узел pure, а обход по `$ref` (путь `/properties/h/$ref`) пропускается в строке 217. Выводится одно сообщение. Есть смежная проблема: для `$ref` на `{type:'string'}` правило (c) выдаёт error, хотя после deref тип допустимый. Это возможный ложный срабатывание с severity error, но сначала надо проверить по спецификации streamable-http, разыменовывают ли клиенты $ref при проверке x-mcp-header.

**Evidence.** node против dist: properties.h = {$ref:'#/$defs/S','x-mcp-header':'X-Tenant'} -> «x-mcp-header on a undefined property. Streamable HTTP clients will drop this tool.»

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/schema_repro.mjs
TOOL-021 {properties:{h:{$ref:'#/$defs/S','x-mcp-header':'X-Tenant'}},$defs:{S:{type:'string'}}} -> [["/properties/h","x-mcp-header on a undefined property. Streamable HTTP clients will drop this tool."]]  (одно сообщение, без 'plain properties chain')
TOOL-021 {properties:{h:{'x-mcp-header':'X-Tenant'}}} -> [["/properties/h","x-mcp-header on a undefined property. ..."]]
```

**Suggested fix.** Печатать `type` через `v.node.type === undefined ? 'property without type' : JSON.stringify(...)`, а для `$ref`-узлов брать тип из `deref()` и не дублировать (c) при уже сработавшей (d).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.85) — Строка 224 актуальна. На сообщение без type нет ни теста, ни оговорки в spec.md §TOOL-021(c). Мини-репро на dist подтверждает текст с 'a undefined'. Часть описания про дублирование с (d) не подтвердилась: walkSchema передаёт pure=true для properties/h, а потомок /$ref отсекается проверкой v.path.endsWith('/$ref'). Дефект косметический, поэтому low.

### F067 [low/bug] TOOL-006: пустая строка `title: ''` затеняет `annotations.title` (`??` не считает '' отсутствующим)

**Where.** `src/rules/tools.ts:122` (reviewer: rules-tools-schema)

**What.** TOOL-006 (src/rules/tools.ts:122) берёт `t.title ?? at`, поэтому пустая строка `title: ''` затеняет непустой `annotations.title`. В итоге claude error «no title», хотя SDK getDisplayName в этом случае откатывается на annotations.title. Литерал в spec.md (`??`) повторяет ту же неточность. Нестроковый title тоже даёт «no title» без указания типа, но это только косметика сообщения.

**Evidence.** node против dist: {title:'', annotations:{title:'Search notes'}} -> [{"platforms":["claude"],"message":"no title"}]; {title:42} -> «no title».

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/tools-repro.mjs
F067a [ 'error [claude] no title' ]   // {title:'', annotations:{title:'Search notes'}}
F067b [ 'error [claude] no title' ]   // {title:42}
```

**Suggested fix.** `const title = isNonEmptyStr(t.title) ? t.title : at;` и отдельное сообщение для title неверного типа (как в TOOL-010 для annotations.title).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.75) — Строка 122 актуальна: `const title = t.title ?? at;`. docs/design/spec.md (TOOL-006) буквально задаёт `tool.title ?? tool.annotations?.title`, так что код совпадает со спекой дословно. Но цель спеки (fix: «title или annotations.title») и эталонное поведение MCP SDK расходятся с кодом: node_modules/@modelcontextprotocol/sdk/dist/esm/shared/metadataUtils.js getDisplayName считает `title === ''` отсутствующим и берёт annotations.title. Значит, для `{title:'', annotations:{title:'Search notes'}}` хост покажет 'Search notes', а линтер выдаёт claude error «no title». Это ложное срабатывание уровня error, хотя и редкий пограничный случай. В test/rules/tools.test.ts такого случая нет, то есть намеренным это поведение не задокументировано. Вторая часть утверждения (`title: 42` даёт «no title» вместо сообщения о неверном типе) про качество сообщения, а не про корректность: finding всё равно выдаётся, и это верно. Спеку тоже стоит поправить: «первое непустое из title, annotations.title».

### F068 [low/bug] TOOL-008: подсчёт слов по пробелам ломается для CJK/тайского — полноценное описание помечается «only 1 words»

**Where.** `src/rules/tools.ts:161` (reviewer: rules-tools-schema)

**What.** `words()` делит по `\s+`; в китайском/японском описании пробелов нет, поэтому длинное предложение даёт 1 «слово», а `d.length < 40` для 20–30 иероглифов выполняется → chatgpt warning «description is too thin». Для рынка (много китайских MCP-серверов) это систематическое ложное срабатывание.

**Evidence.** node против dist: description '按关键字搜索用户文档并返回匹配的文档标识和标题列表。' (25 символов, полное предложение) -> [{"platforms":["chatgpt"],"message":"description is too thin: only 1 words"}].

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/tools-repro.mjs
F068 zh [ 'warning [chatgpt] description is too thin: only 1 words' ]  // '按关键字搜索用户文档并返回匹配的文档标识和标题列表。'
F068 ja [ 'warning [chatgpt] description is too thin: only 1 words' ]  // 'キーワードでユーザーのメモを検索し、一致するメモのIDとタイトルを返します。'
```

**Suggested fix.** Использовать `Intl.Segmenter(undefined,{granularity:'word'})` для подсчёта слов, либо отключать словесный критерий, если текст содержит `\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Thai}`, оставляя только символьный порог с учётом «плотности» CJK (например, 1 CJK-символ ≈ 2 латинских).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — Строка 161 актуальна: `if (w.length < 6 && d.length < 40)`, а words() в src/rules/util/text.ts:122-124 режет текст по `\s+`. В CJK-тексте пробелов нет, поэтому выходит одно «слово», и предложение короче 40 символов (а в CJK это уже полноценная фраза) получает chatgpt warning. В spec.md порог задан только в словах и символах, CJK и другие письменности без пробелов в нём не упоминаются, тестов на такой ввод нет. Значит, это не намеренное решение, а неучтённый случай. Подтверждено на китайском и на японском. Severity low: это warning, и он срабатывает только на коротких описаниях (меньше 40 code units).

### F069 [low/bug] TOOL-014: двойное срабатывание (a)+(b) на одной причине и срабатывание (b) без объекта annotations вопреки комментарию у (e)

**Where.** `src/rules/annotations.ts:109` (reviewer: rules-tools-schema)

**What.** TOOL-014 (src/rules/annotations.ts:100,110,115): firstVerb(name) берёт первый глагол из ALL_VERBS, поэтому инструмент, в имени которого есть и read-, и write/destructive-слово (например `search_and_replace` с destructiveHint:true), получает warning (c) «read verb "search" but destructiveHint: true» на claude/chatgpt/spec, а при отсутствии readOnlyHint ещё и spec-finding (e) «readOnlyHint is absent (treated as destructive…)», хотя инструмент и так явно destructive. Ложное срабатывание эвристики при корректных хинтах. Остальные части исходного утверждения не подтверждены: (b) без объекта annotations срабатывает намеренно, а пара (a)+(b) для delete_note+readOnlyHint:true соответствует спеке и указывает на два разных неверных хинта.

**Evidence.** node против dist: delete_note + readOnlyHint:true -> 2 findings; delete_note без annotations -> [{"message":"\"delete\" tool without destructiveHint: true"}]; search_and_replace + destructiveHint:true -> «read verb "search" but destructiveHint: true».

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f069.mjs (TOOL_014.check({tools:[t]}) из dist/rules/annotations.js):
delete_note+readOnlyHint:true -> [{"message":"marked readOnlyHint but name starts with write verb \"delete\""},{"message":"\"delete\" tool without destructiveHint: true"}]
delete_note без annotations -> [{"message":"\"delete\" tool without destructiveHint: true"}]  (ожидаемо по test/rules/tools.test.ts:220)
search_and_replace+destructiveHint:true -> [{"message":"read verb \"search\" but destructiveHint: true"},{"platforms":["spec"],"message":"read verb \"search\" but readOnlyHint is absent (treated as destructive and open-world by default)"}]
```

**Suggested fix.** В (b) пропускать случай `a.readOnlyHint === true` (уже сообщён в (a)) и, по аналогии с (e), требовать `isObj(t.annotations)`; в firstVerb/toolKind учитывать, что имя содержит и read-, и write-глагол (`search_and_replace`, `get_or_create`) — считать такой инструмент write/unknown.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.6) — Исходное утверждение составное, проверял каждую часть. (1) «(b) срабатывает без annotations вопреки комментарию у (e)» — опровергнуто. Комментарий на строке 114 относится только к (e). test/rules/tools.test.ts:215-221 прямо фиксирует намеренное поведение: `// the write-verb checks still run without annotations` и ожидает ['"delete" tool without destructiveHint: true'] для delete_note без annotations. Позитивный кейс TOOL-014 в tools.test.ts:43 — это тоже delete_note без annotations. (2) «Двойное срабатывание (a)+(b)» — в docs/design/spec.md:468-469 это две независимые проверки. Неверны два разных хинта (readOnlyHint:true надо исправить, destructiveHint:true надо добавить), исправлений тоже два, так что это не дубль; дефектом не считаю. (3) `search_and_replace` — подтверждено: firstVerb возвращает 'search' (READ_VERBS), а 'replace' не входит в ALL_VERBS (он есть только в IRREVERSIBLE), поэтому (c) выдаёт warning на корректно размеченный destructive-инструмент, и вдобавок срабатывает (e). Поведение формально совпадает со спекой («v = firstVerb(name)»), но для эвристики это реальный false positive. Ни один тест его не закрепляет. Строка 109 актуальна, хотя для части (3) релевантны строки 110 и 115. Severity — low: только warning, правило помечено как heuristic.

### F070 [low/bug] TOOL-019: $ref на embedded resource с собственным `$id` внутри `$defs` считается «сетевой» ссылкой

**Where.** `src/rules/schema.ts:177` (reviewer: rules-tools-schema)

**What.** TOOL-019 (src/rules/schema.ts:177-180): локальной считается только ссылка на корневой `$id`. Если `$ref` указывает на `$id` вложенного ресурса внутри `$defs` (например `urn:acme:addr`), правило выдаёт warning «$ref points outside the document», хотя ссылка резолвится внутри документа. Это расходится с docs/design/spec.md («resolves (against $id) to an absolute URI outside the document»). На практике в MCP-схемах такое встречается редко. Вторая часть, где относительный ref без корневого `$id` пропускается молча, — это не баг по spec: такой ref не резолвится в абсолютный URI. Это скорее предложение по улучшению.

**Evidence.** node против dist: properties.a.$ref='urn:acme:addr', $defs.Addr.$id='urn:acme:addr' -> [{"path":"inputSchema/properties/a","message":"$ref points outside the document: urn:acme:addr"}].

**Repro (verifier).**

```
TOOL-019 {properties:{a:{$ref:'urn:acme:addr'}},$defs:{Addr:{$id:'urn:acme:addr',type:'string'}}} -> [["inputSchema/properties/a","$ref points outside the document: urn:acme:addr"]]
TOOL-019 {properties:{a:{$ref:'other.json'}}} -> []
```

**Suggested fix.** Собрать через walkSchema множество всех `$id`/`$anchor` (резолвленных относительно базы) в документе и не репортить ref, попадающий в это множество; для относительных ref без базы выдавать отдельное info «relative $ref without $id».

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.7) — Строки актуальны, ссылка при этом URL-конструктор на 177, сам push на 180. В test/rules/tools.test.ts для TOOL-019 есть только pos (https-ref) и neg (#/$defs), про embedded $id тестов нет, так что поведение не задумано явно. Spec-формулировка 'outside the document' поддерживает finding. Репро на dist подтверждает. Пропуск относительного ref тоже подтверждён (возвращается []), но spec требует абсолютный URI, поэтому это не нарушение.

### F071 [low/bug] walkSchema/schemaMetrics не обходят `dependentSchemas`, `dependencies` (schema-форма) и `additionalItems` — пропуски в TOOL-009/021/022/015/020

**Where.** `src/rules/util/schemaWalk.ts:52` (reviewer: rules-tools-schema)

**What.** Строки 51-52 (COMBINATORS/SINGLE) актуальны. Ни walkSchema, ни schemaMetrics не заходят в `dependentSchemas`, в `dependencies` со схемами-значениями и в `additionalItems`. Поэтому подсхемы под этими ключами не видны правилам, которые пользуются walker'ом (src/rules/schema.ts, tools.ts, data.ts, annotations.ts, util/text.ts), и не попадают в метрики depth/count TOOL-020. По spec §1.5 расхождения нет: там перечислен закрытый список ключей, и этих трёх в нём нет. При этом код уже обходит больше, чем требует spec (patternProperties, contains, propertyNames, unevaluated*). Значит, это пробел в покрытии, а не нарушение замысла. В test/ нет теста, который делал бы это поведение намеренным. Влияние небольшое: в inputSchema MCP-инструментов такие ключи встречаются редко, и правила дают только ложноотрицательные результаты.

**Evidence.** node против dist: walkSchema({type:'object', dependentSchemas:{a:{properties:{secret_token:{type:'string','x-mcp-header':'X'}}}}}) посещает только ['/'].

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f071.mjs
// dependentSchemas с x-mcp-header на secret_token:
["/"] {"depth":0,"count":1}
// dependencies (форма со схемой):
["/"] {"depth":0,"count":1}
// items:[..] + additionalItems:{properties:{x}}:
["/","/items/0"] {"depth":1,"count":2}
```

**Suggested fix.** Добавить обход `dependentSchemas` (объект имя→схема, как $defs), `dependencies` (значения-объекты), `additionalItems` (SINGLE); синхронно обновить schemaMetrics.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.75) — Проверил код (src/rules/util/schemaWalk.ts:51-52, 61-83, 95-113): ни в одной ветке нет dependentSchemas, dependencies и additionalItems. По grep в src/test/docs/design эти ключи нигде не упоминаются, кроме npm dependencies, так что ни выше, ни ниже по стеку их никто не обрабатывает. Spec §1.5 (docs/design/spec.md:77) называет walker обходом конкретного списка ключей, и этих трёх в нём нет. Утверждение spec не противоречит, но фиксирует реальный пробел относительно JSON Schema 2020-12 и draft-07. Мини-репро на dist подтвердило пропуск.

### F073 [low/bug] TOOL-031: корневой `$ref` в outputSchema не разворачивается — ложный error «lacks a required string id»

**Where.** `src/rules/tools.ts:480` (reviewer: rules-tools-schema)

**What.** TOOL-031 (src/rules/tools.ts:477-481) читает properties, required и additionalProperties из корня outputSchema без deref. Если в корне стоит локальный `$ref` на `$defs`, правило ложно выдаёт error «lacks a required string id» и warning про additionalProperties. TOOL-030 при этом $ref разрешает, так что поведение внутри файла непоследовательно. Случай редкий.

**Evidence.** node против dist: outputSchema {$ref:'#/$defs/P', $defs:{P:{properties:{id:{type:'string'}}, required:['id'], additionalProperties:false}}} -> [«profile outputSchema lacks a required string id», warning «profile output should contain only id, name, email, nickname…»].

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/tools-repro.mjs
F073 [
  'error [chatgpt] profile outputSchema lacks a required string id',
  'warning [chatgpt] profile output should contain only id, name, email, nickname with additionalProperties: false'
]  // outputSchema {$ref:'#/$defs/P',$defs:{P:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}}}
```

**Suggested fix.** Применять `deref(t.outputSchema, t.outputSchema)` перед чтением полей (и deref для каждого property в TOOL-030/031); для tuple-items в TOOL-030 выдавать явное сообщение.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.6) — Строки 477-481 актуальны: properties(t.outputSchema), required и additionalProperties читаются с корня без deref. В том же файле TOOL-030 вызывает deref для каждого свойства, а spec.md для TOOL-030 прямо требует разрешать локальные $ref. Для TOOL-031 спека об этом молчит, тестов с $ref в outputSchema нет. Вход берётся из сырого tools/list (listAll в connect.ts), без нормализации. Схема `{type:'object', $ref:'#/$defs/P', $defs:{...}}` валидна для JSON Schema 2020-12, и семантически в ней есть обязательный строковый id, а линтер выдаёт chatgpt error и warning, то есть ложное срабатывание. Оговорка: если в корне нет `type:'object'`, такая схема и так нарушает MCP-схему Tool.outputSchema, и тогда ругаться правомерно, хоть и другим сообщением. Корневой $ref в outputSchema встречается редко, поэтому severity low. Подпункт про tuple-items в TOOL-030 тоже верен: строка 442 молча делает `continue`, но это мелочь.

### F074 [low/bug] TOOL-018: схема только с `patternProperties`/`propertyNames`/`unevaluatedProperties` помечается как «takes no parameters»

**Where.** `src/rules/schema.ts:153` (reviewer: rules-tools-schema)

**What.** TOOL-018 (src/rules/schema.ts:140,153): инструмент считается беспараметровым, если нет непустого `properties`, нет ключей из COMPOSITION и не выставлено `additionalProperties:false`. Поэтому схемы, которые принимают произвольные ключи (`patternProperties`, `additionalProperties` как схема, например map `{type:'string'}`, `propertyNames`, `unevaluatedProperties`, `dependentSchemas`), получают ложное info «tool takes no parameters». Формально это совпадает с буквой spec.md («no properties, no composition keywords»), но противоречит смыслу правила «Parameterless tool».

**Evidence.** node против dist: inputSchema {type:'object', patternProperties:{'^x-':{type:'string'}}} -> [{"message":"tool takes no parameters but does not set additionalProperties: false"}].

**Repro (verifier).**

```
TOOL-018 {type:'object',patternProperties:{'^x-':{type:'string'}}} -> [[null,"tool takes no parameters but does not set additionalProperties: false"]]
TOOL-018 {type:'object',additionalProperties:{type:'string'}} -> то же
TOOL-018 {type:'object',propertyNames:{pattern:'^a'}} -> то же
```

**Suggested fix.** Расширить список исключений: patternProperties (непустой), propertyNames, unevaluatedProperties, dependentSchemas, additionalProperties как объект.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — Строка 153 актуальна. В тестах для TOOL-018 есть только {type:'object'} и additionalProperties:false, случаи с patternProperties и additionalProperties-схемой не покрыты. Сообщение прямо утверждает, что параметров нет, а это неверно для map-подобных аргументов, особенно для распространённого additionalProperties:{type:...}. Severity правила info, ложное срабатывание шумит, но не блокирует, поэтому low.

### F085 [low/bug] RT-010: токены ищутся только в JSON-распарсенных корнях — секрет в обычном тексте результата не детектируется

**Where.** `src/rules/runtime.ts:237` (reviewer: rules-injection-data-policy-apps)

**What.** RT-010 проверяет TOKEN_RE только по строковым значениям внутри structuredContent и внутри JSON, разобранного из текста. Разбирается текст целиком или каждая строка по отдельности. Так прямо задано в docs/design/spec.md («walk structuredContent and any JSON parsed from text»). Поэтому токены в свободном тексте (`Your session token: eyJ...`, `Bearer sk-...`) и в pretty-printed JSON внутри markdown code fence не обнаруживаются. Это пробел покрытия на уровне спецификации, а не расхождение кода с замыслом. Исправлять нужно spec, код и тесты вместе: добавить глобальный поиск TOKEN_RE по textOf(r). KNOWN_TOKEN из src/rules/util/net.ts заякорен ^…$ и для поиска подстрок напрямую не подходит.

**Evidence.** RT_010.check с content text 'Your session token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIi....dBjf... Authorization: Bearer sk-ant-api03-...' → []; тот же JWT внутри JSON {"token":...} → severity error 'result contains token-like values: eyJh…'.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f085arb.mjs  (import { RT_010 } from dist/rules/runtime.js; snapshot {tools:[], active:{calls:[{tool:'t',kind:'valid',result:{content:[{type:'text',text}]}}]}})
plain [] <- "Your session token: <JWT>\nAuthorization: Bearer sk-ant-api03-..."
json  [{"severity":"error","message":"result contains token-like values: eyJh…"}]
md    [] <- "```json\n{\"token\": \"<JWT>\"\n}\n```"
line  [error] <- "result:\n{\"token\":\"<JWT>\"}"
sc+plaintext [] <- text "token <JWT>" + structuredContent {title:'x'}
```

**Suggested fix.** Дополнительно прогонять TOKEN_RE (глобально) по `textOf(r)` целиком и добавлять совпадения в `tokens`; заодно переиспользовать KNOWN_TOKEN из util/net.ts (sk_live, glpat-, xox*, AIza, npm_, hf_, github_pat_) вместо узкого локального TOKEN_RE.

**Verifier votes.**

- *reader*: REFUTED (conf 0.7) — Само поведение воспроизводится: RT_010 ищет токены только в structuredContent и в JSON, распарсенном из текста (src/rules/runtime.ts:236-244, номер строки 237 актуален). Обычный текстовый результат с JWT находок не даёт. Но это не расхождение с замыслом, а именно то, что задано в спецификации. В docs/design/spec.md:1030-1034 для RT-010 написано: «Detect: walk `structuredContent` and any JSON parsed from text», а значения проверяются по JWT/sk-/ghp_/AKIA. Код выполняет это требование точно. Тест test/rules/runtime.test.ts:50-53 и :159-160 проверяет только случаи с JSON и structuredContent, то есть область действия правила выбрана сознательно. Сканирование всего текста по KNOWN_TOKEN, которое предлагает автор, расширило бы правило сверх спецификации. Это доработка спецификации, а не ошибка корректности. Кроме того, у RT-010 severity в каталоге — только chatgpt: warning: правило эвристическое и не обещает находить секреты везде. Если доработку всё же решат принять, ей подойдёт severity low/medium как пробелу в покрытии, а не high: сам инструмент секретов не раскрывает, он лишь пропускает их в отчёте.
- *repro*: confirmed (conf 0.93) — Находка подтверждена. В src/rules/runtime.ts:236-243 правило RT_010 строит `roots` только из `structuredContent` и из результатов `JSON.parse` (по каждой строке и по всему тексту). Затем TOKEN_RE применяется в `walkJson` к строковым значениям внутри этих корней. Если текст не парсится как JSON, он в `roots` не попадает, поэтому TOKEN_RE его вообще не проверяет. Исключение одно: строка целиком является JSON-строкой в кавычках. Воспроизвёл против dist/rules/runtime.js. Текстовый результат с JWT и `Bearer sk-ant-...` дал [], а тот же JWT внутри JSON {"token":...} дал находку уровня error. Severity medium: это ложноотрицательный результат проверки секретов в реалистичном случае, когда сервер возвращает токен обычным текстом. Самим линтером секрет не утекает, основной сценарий не ломается, поэтому не high. Часть suggested_fix про KNOWN_TOKEN — отдельное улучшение покрытия, я его не проверял.
- *ARBITER (round 2)*: confirmed (conf 0.85) — [partially-confirmed] Что верно (факт). В src/rules/runtime.ts:236-244 RT_010 собирает `roots` только из `r.structuredContent`, из `JSON.parse` каждой строки `textOf(r)` и из `JSON.parse` всего текста. TOKEN_RE (строка 214) применяется в `walkJson` только к строковым значениям внутри этих корней. Свободный текст regex не проверяет совсем. Я сам воспроизвёл это против dist (/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f085arb.mjs):
- `Your session token: <JWT>\nAuthorization: Bearer sk-ant-...` → [];
- `JSON.stringify({token: jwt})` → error;
- текст, где JSON стоит на отдельной строке после префикса → error.

Дополнительно, сверх исходной находки: pretty-printed JSON внутри markdown-ограждения ```json ... ``` даёт [], потому что не парсится ни целиком, ни построчно. Плоский текст при наличии structuredContent тоже даёт []. Значит, пропуск касается и типичной формы ответа «JSON в code fence», а не только прозы.

Аргумент верификатора «reader» (refuted, 0.7) в основном верен. В docs/design/spec.md (блок RT-010, около :1030-1034) прямо сказано: «Detect: walk `structuredContent` and any JSON parsed from text». Значения проверяются по JWT/sk-/ghp_/AKIA уже внутри этого обхода. Для соседнего RT-011 спецификация, напротив, пишет «regexes run over result text». Авторы, таким образом, осознанно различали «обход JSON» и «текст результата». Тесты test/rules/runtime.test.ts:50-53 и :159-163 покрывают только JSON и structuredContent. Код точно соответствует спецификации, поэтому расхождения реализации с замыслом нет. Это пробел покрытия на уровне самой спецификации. Не принимаю довод о том, что «правило эвристическое и не обещает находить всё». rationale правила («Results must not expose ... credentials») и уровень error для токенов показывают, что обнаружение секретов — его прямая цель. Ложноотрицательный результат в реалистичном случае (токен в прозе или в fenced JSON) остаётся реальным недостатком, хотя и задокументированным.

Аргумент верификатора «repro» (confirmed, 0.93, medium) верен по механике, но не учитывает, что поведение задано спецификацией. Поэтому классифицировать находку как bug уровня medium некорректно. Правильнее считать её пробелом в покрытии или доработкой spec и кода. Инструмент сам секретов не раскрывает: он лишь не сообщает о них, и основной сценарий не ломается. Severity: low.

Про suggested_fix. Идея прогонять TOKEN_RE с флагом /g по всему `textOf(r)` разумна. Ложных срабатываний немного: `\bsk-` не совпадает внутри слов вроде `task-`/`risk-`, остаётся в основном риск JWT-примеров в документации. Но изменение нужно вносить одновременно в spec.md, в код и в тесты. Переиспользовать KNOWN_TOKEN из src/rules/util/net.ts:98 как есть нельзя: регулярное выражение заякорено `^...$` и рассчитано на проверку значения целиком, а не на поиск подстроки. Кроме того, путь в находке указан неверно: файл лежит в src/rules/util/net.ts, а не в util/net.ts. Эту часть находки считаю неточной.

Итог: partially-confirmed. Поведение (пропуск токенов в не-JSON тексте) подтверждено. Квалификация «баг реализации» и severity medium опровергнуты: это пробел, заданный спецификацией. Рекомендация по KNOWN_TOKEN в предложенном виде неприменима.

### F086 [low/bug] DATA-003: SECRET_NAMES заякорен на всё имя — new_password, db_password, github_token, credentials не ловятся

**Where.** `src/rules/data.ts:96` (reviewer: rules-injection-data-policy-apps)

**What.** DATA-003 сопоставляет только точные имена из списка в спеке (spec.md, DATA-003; data.ts:96), поэтому составные имена секретов не ловятся: new_password, db_password, github_token, aws_secret_access_key, secret_key, credentials, authorization. Реализация соответствует спеке, так что это пробел покрытия, а не баг кода. Предложенный фикс через isSecretName на уровне error неприемлем: он даёт FP на key, sort_key, primary_key, session, cookie, auth, signature, password_policy и нарушает §1.2 (эвристика → warning). Правильный путь: изменить спеку и добавить warning-ветку по последнему сегменту password/token/secret/credentials/*_api_key/*_access_key/*_secret_key с исключениями *_id/_count/_policy/_url/_file.

**Evidence.** DATA_003.check на схеме с old_password,new_password,db_password,aws_secret_access_key,github_token,apiKey,credentials,authorization → единственная находка /properties/apiKey. isSecretName('new_password')=true, isSecretName('github_token')=true.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f086arb.mjs: скрипт импортирует DATA_003 из dist/rules/data.js и isSecretName из dist/rules/util/net.js и прогоняет один tool, где каждое имя задано отдельным string-свойством.
POS: DATA-003 ловит только password и apiKey. old_password, new_password, newPassword, db_password, user_password, github_token, githubToken, bot_token, apiToken, aws_secret_access_key, secret_key, credentials, authorization дают false, хотя isSecretName для всех них возвращает true.
NEG: isSecretName возвращает true для key, sort_key, cache_key, partition_key, primary_key, foreign_key, session, cookie, auth, pass, signature, password_policy и false только для token_count, max_tokens, tokens. Значит, предложенный в находке фикс дал бы chatgpt=error на безопасных параметрах.
```

**Suggested fix.** В scanNames для DATA-003 использовать `isSecretName(v.rawName) || SECRET_NAMES.test(v.name)`; оставить `pin` отдельной warning-веткой.

**Verifier votes.**

- *reader*: REFUTED (conf 0.7) — Фактическая часть утверждения верна: src/rules/data.ts:96 (строка актуальна) содержит заякоренный `SECRET_NAMES = /^(password|...|mnemonic)$/i`. `scanNames` сверяет его с `v.name`, а это имя, приведённое к snake_case (schemaWalk.ts:60). Поэтому `old_password`, `db_password`, `github_token`, `credentials` и `authorization` действительно не ловятся, а `apiKey` (`api_key`) ловится.

Но дефектом реализации это не является, а предложенный фикс неверен.
1) docs/design/spec.md:666-670 задаёт для DATA-003 ровно этот regex дословно, вместе с якорями `^...$`. Реализация совпадает со спекой символ в символ. Это осознанный выбор, а не ошибка в коде.
2) По spec §1.2 severity `error` допускается только при детерминированной детекции. Любая regex- или словарная эвристика должна быть `warning`, «чтобы избежать false positives». DATA-003 даёт `chatgpt=error` именно потому, что сопоставление идёт по точному списку имён. Если расширить его до сегментов и суффиксов, правило станет эвристикой и нарушит §1.2.
3) Фикс `isSecretName(v.rawName) || ...` взят из логики редакции, а она по замыслу fail-closed (комментарий в util/net.ts: «redaction, fail-closed»). Для редакции лишнее срабатывание ничего не стоит. Для правила уровня `error` такие срабатывания ложные. `SECRET_SIGN` срабатывает на отдельные сегменты `key`, `auth`, `session`, `cookie`, `signature`, `pass`. Значит, параметры `key` (KV-store), `session`, `auth`, `cookie`, `signature`, `sort_key`, `cache_key` получили бы `chatgpt=error`. Это прямо противоречит §1.2 и превратит рабочие серверы в BLOCKED.
4) Тест test/rules/content.test.ts:67-70 проверяет только точные имена (`password` даёт error, а `pin` даёт warning, строка 170). Тестов, которые требовали бы ловить имена с префиксом или суффиксом, нет.

Итог: это ограничение полноты, заложенное в спеку, а не баг корректности. Самое большее, это предложение по улучшению: добавить отдельную ветку уровня `warning` для имён с суффиксами `_password` или `_token`, и сначала изменить спеку. С ошибочным fix'ом и severity medium как баг кода утверждение не подтверждается.
- *repro*: confirmed (conf 0.92) — Подтверждено. В src/rules/data.ts:96 регулярка SECRET_NAMES заякорена на всё имя (^...$). scanNames в DATA-003 проверяет её против v.name, а это snakeCase от rawName. Поэтому составные имена вроде old_password, new_password, db_password, smtp_password, aws_secret_access_key, github_token, credentials и authorization не совпадают ни с одной альтернативой. Регулярка срабатывает только на точные имена: password, api_key/apiKey и т.п. При этом isSecretName из src/rules/util/net.ts распознаёт все эти имена как секретные (вернула true для каждого), а редакция и трассировка уже на неё опираются. Получается ложноотрицательный результат правила с severity chatgpt=error на реалистичных схемах: параметр смены пароля new_password или github_token сервер-обёртки пройдёт проверку без находки. На безопасность самого инструмента это не влияет и утечки секретов нет. Зато линтер выдаёт неверный результат в реальных случаях, поэтому severity остаётся medium. Оговорка к suggested_fix: isSecretName рассчитана на редакцию и работает в режиме fail-closed. Если подключить её в DATA-003 как есть, ложных срабатываний может стать больше (например, на token_count или password_policy, если NOT_SECRET их не исключает). Это проверялось только частично: прогон шёл лишь на позитивном наборе имён.
- *ARBITER (round 2)*: confirmed (conf 0.85) — [partially-confirmed] Арбитраж F086 (DATA-003, src/rules/data.ts:96). Файла evidence/known-round1.json на диске нет, поэтому я сверялся только с сырой находкой и голосами.

ЧТО ВЕРНО (фактическая часть, подтверждаю репро):
SECRET_NAMES заякорен целиком (`^(...)$`). scanNames (data.ts:14-34) проверяет его против `v.name` в snake_case. Мой прогон против dist/ показал, что DATA-003 пропускает old_password, new_password, newPassword, db_password, user_password, github_token, githubToken, bot_token, apiToken, aws_secret_access_key, secret_key, credentials, authorization. Ловятся только точные `password` и `apiKey`. isSecretName возвращает true для всех этих имён. На реалистичных схемах (смена пароля, GitHub/Slack-обёртки) правило с chatgpt=error даёт ложноотрицательный результат. Голос repro здесь прав.

ЧТО НЕВЕРНО:
1) Это не баг реализации относительно замысла. docs/design/spec.md (блок DATA-003) дословно задаёт тот же заякоренный regex, и реализация совпадает со спекой символ в символ. Тест test/rules/content.test.ts:67-71 и :170-171 покрывает только точные имена и `pin`. Значит, это пробел полноты, заложенный в спеку, а не расхождение кода с замыслом. Голос reader здесь прав.
2) Предложенный suggested_fix (`isSecretName(v.rawName) || ...` на уровне error) вреден. Мой прогон дал isSecretName=true на заведомо безопасных именах: key, sort_key, cache_key, partition_key, primary_key, foreign_key, session, cookie, auth, pass, signature, password_policy. Исключения работают только для token_count, max_tokens и tokens. Функция задумана как fail-closed для редакции (комментарий в util/net.ts:91), и в DATA-003 она дала бы chatgpt=error, то есть BLOCKED, на KV- и DB-серверах. Вдобавок §1.2 спеки прямо требует: «any heuristic (regex or word-list) detection → warning». Сегментное или суффиксное сопоставление — эвристика, error для него недопустим. Верификатор repro сам оговорил риск FP, но не проверил его. Я проверил, и риск подтверждается.

ИТОГ: частично подтверждено. FN реален и практически значим, но спеке он соответствует, а фикс из находки ошибочен. Severity low: это пробел покрытия или улучшение, а не дефект корректности относительно спеки. Аргумент «medium, потому что правило error» не проходит: корректный фикс по §1.2 сам может дать только warning.

Рекомендуемый фикс: сначала изменить спеку, затем добавить в DATA-003 отдельную ветку severity 'warning'. Она должна сопоставлять составные имена с последним сегментом password/passwd/token/secret/credentials/api_key/access_key/secret_key (в т.ч. camelCase), с исключениями *_id/_count/_policy/_type/_url/_file. Голые key/session/cookie/auth/signature и *_key (sort/primary/partition/cache) не включать. Добавить позитивные и негативные тесты. Основную ветку error оставить на точном списке.

### F089 [low/bug] DATA-005: имя `address` трактуется как геолокация — email/IP/wallet/contract address

**Where.** `src/rules/data.ts:132` (reviewer: rules-injection-data-policy-apps)

**What.** DATA-005 (src/rules/data.ts:132, совпадает со spec.md:682) определяет геолокацию только по имени параметра, и skip у него нет. Поэтому `long` типа boolean/integer и `address` с format email/ipv4/ipv6/uri (а также адреса кошельков 0x...) дают ложный chatgpt-warning «requests a precise location». Детерминированная часть исправления — skip по type (только string/number) и по format, по аналогии с DATA-003 (spec.md:658, data.ts:74). Фильтрация по словам из description — это изменение эвристики, и её сначала нужно согласовать в spec.md.

**Evidence.** DATA_005.check для get_balance с {address:{description:'Ethereum wallet address (0x...)'}} → 'parameter "address" requests a precise location'.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f089arb.mjs — скрипт вызывает DATA_005.check из dist/rules/data.js. Вывод: срабатывания на get_balance.address (Ethereum wallet), ping.address (format ipv4), ping.long (type boolean) и ship.address (shipping street — корректное срабатывание).
```

**Suggested fix.** Для `address` требовать подтверждение из description/format: матч `street|postal|home|shipping|billing|physical|location` и отсутствие `email|ip|wallet|contract|0x|mac`; либо `format: email/ipv4/ipv6` → skip. Аналогично `long` (часто boolean «long format»).

**Verifier votes.**

- *reader*: REFUTED (conf 0.7) — Само поведение подтверждается: на строке 132 файла src/rules/data.ts регулярное выражение DATA-005 содержит `address`. Функция scanNames (data.ts:14-34) проверяет только имя параметра, а description и format не смотрит. Поэтому для wallet- или IP-адреса правило выдаёт warning (repro ниже).

Но это не ошибка, а поведение, прямо прописанное в спецификации. В docs/design/spec.md:680-686 для DATA-005 указан именно этот regex, включая `address`, с результатом warning. Там же сказано: «This is a heuristic (the coordinates may describe a place, not the user), so it stays a warning». В §1.2 (spec.md:36) severity warning предписана для любых regex-эвристик как раз потому, что у них бывают ложные срабатывания. Правило работает только для chatgpt и с уровнем warning, то есть не блокирует и только просит человека проверить.

В test/ нет теста, который запрещал бы такой результат. Тест content.test.ts:75 проверяет только latitude/longitude, а tools.test.ts:59 — `address` с $ref, и тот путь scanNames пропускает. Строка 132 в файле актуальна.

Предложение автора — сузить `address` по description/format и заодно `long` — это улучшение эвристики, которое требует сначала изменить спецификацию. Отклонением кода от замысла оно не является. Если всё же считать это дефектом, то severity у него low: лишний warning на редких профилях (crypto, сетевые инструменты), а не medium.
- *repro*: confirmed (conf 0.9) — src/rules/data.ts:132: в DATA-005 стоит `re: /^(lat|...|long|longitude|...|street(_address)?|address)$/i`. scanNames (data.ts:14-34) смотрит только на имя параметра и не учитывает ни description, ни format, ни type, а поля skip у этого правила нет. Поэтому любой параметр с именем `address` (адрес кошелька, IP, e-mail) и любой `long` (даже type:boolean) получают на платформе chatgpt warning «requests a precise location» с советом про `openai/userLocation`. Я воспроизвёл это на dist/rules/data.js: срабатывают все четыре случая, включая `format: email`, `format: ipv4` и boolean `long`. В реальных серверах так бывает часто: крипто- и web3-MCP (address = wallet), сетевые утилиты, почтовые инструменты. Каждое такое срабатывание ложное, и автор получает неверный совет. Это ошибочный результат, а не просто косметика. Уровень warning, а не error, и на основной сценарий находка не влияет, поэтому severity = medium.
- *ARBITER (round 2)*: confirmed (conf 0.85) — [partially-confirmed] Факты, проверенные самостоятельно. В src/rules/data.ts:132 у DATA-005 стоит regex `/^(lat|latitude|lng|lon|long|longitude|coords?|coordinates|gps|geo(location)?|street(_address)?|address)$/i`. В scanNames (data.ts:14-34) есть механизм `skip` (NameRule.skip), но у DATA-005 он не задан, поэтому решение принимается только по имени: description, format и type не учитываются. Репро на dist (/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f089arb.mjs) выдаёт «requests a precise location» на четырёх случаях: wallet `address` (0x...), `address` с format:ipv4, boolean `long` и (корректно) shipping street address. Само поведение, таким образом, подтверждено.

Аргументы «refuted» (lens reader). Код буквально совпадает со спецификацией: docs/design/spec.md:682 задаёт тот же regex, включая `address` и `long`, без всяких исключений. §1.2 (spec.md:36) предписывает уровень warning для любых regex-эвристик именно из-за ложных срабатываний. Правило работает только для chatgpt и не блокирует. В этом верификатор прав: расхождения кода с замыслом нет, а предложенный в находке фильтр по description (wallet|0x|email...) — это изменение спецификации, а не исправление реализации. Однако его довод «spec прямо допускает такие FP» натянут. spec.md:685 оговаривает другой класс FP: «coordinates may describe a place, not the user», то есть координаты места, а не пользователя. Wallet/IP/e-mail адреса и boolean-флаг `long` — вообще не локация, и spec их не обсуждает. Кроме того, в той же спецификации есть прецедент типового skip для эвристик по имени: spec.md:658 (DATA-003, weak names) — «skipped for integer, number or boolean parameters», и он реализован в data.ts:74 через `isNonText`. Значит, отсечение заведомо нелокационных типов вполне в духе замысла. То, что для DATA-005 такой оговорки нет, — пробел в спецификации, а не сознательное решение.

Аргументы «confirmed» (lens repro). Репро верное, ложные срабатывания реальны и типичны для web3, сетевых и почтовых MCP-серверов, а совет про `openai/userLocation` в этих случаях бессмыслен. Но severity medium завышена: это warning (не error), правило действует только при target chatgpt/all, не влияет на exit-статус как блокер и в части `address`/`long` соответствует написанному spec.

Итоговый вердикт: partially-confirmed.
- Верно: DATA-005 даёт ложные chatgpt-warning на нелокационных параметрах.
  - Для boolean/integer `long` (и вообще нестроковых/нечисловых типов) и для `address` с `format` email/ipv4/ipv6/uri это дефект, устранимый детерминированно через существующий `skip`, по прецеденту DATA-003. Подтверждаю как low.
  - Фильтрация по словам из description (wallet|0x|contract|mac) — это эвристическое улучшение, которое требует сначала изменить spec.md:682. Как баг реализации не подтверждаю.
- Неверно: утверждение, что код отклоняется от замысла. Реализация соответствует spec.md:682.

Severity: low (лишний warning, не блокирующий, на узком классе серверов). Примечание: пункт про C004 (Windows npx/.cmd) к F089 не относится и в этом арбитраже не рассматривался.

### F090 [low/bug] INJ-001: исключение emoji-ZWJ не покрывает последовательности с VS16/модификатором тона кожи (❤️‍🔥, 👩🏽‍💻, 🏳️‍🌈)

**Where.** `src/rules/injection.ts:73` (reviewer: rules-injection-data-policy-apps)

**What.** INJ-001 (src/rules/injection.ts:73, строка актуальна) пропускает U+200D только тогда, когда непосредственно слева и справа стоят кодпоинты \p{Extended_Pictographic}. Во многих стандартных RGI emoji ZWJ-последовательностях между ними стоят VS16 (U+FE0F) или модификатор тона кожи (U+1F3FB–1F3FF): ❤️‍🔥, 🏳️‍🌈, 🏳️‍⚧️, 👩🏽‍💻, 🧑🏿‍🚀. Для таких последовательностей правило выдаёт warning «invisible format characters \u{200D}». Получается ложное срабатывание на уровне warning, error не возникает. Код дословно повторяет формулировку spec.md:591 («between two \p{Extended_Pictographic} characters»), но та же строка заявляет цель «emoji ZWJ sequences are exempt», и эти последовательности под неё подпадают. Тест test/rules/content.test.ts:108 покрывает только 👨‍👩‍👧 без VS16 и модификаторов.

**Evidence.** hiddenChars('👩🏽‍💻') → {soft:['\\u{200D}']}; hiddenChars('❤️‍🔥') → {soft:['\\u{200D}']}; hiddenChars('🏳️‍🌈') → {soft:['\\u{200D}']}. INJ_001.check на описании 'React with ❤️‍🔥 or 👩🏽‍💻' → warning.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f090.mjs (import { hiddenChars } from dist/rules/injection.js):
"👩🏽‍💻" {"hard":[],"soft":["\\u{200D}"]}
"❤️‍🔥" {"hard":[],"soft":["\\u{200D}"]}
"🏳️‍🌈" {"hard":[],"soft":["\\u{200D}"]}
"👨‍👩‍👧" {"hard":[],"soft":[]}
"🧑🏿‍🚀" {"hard":[],"soft":["\\u{200D}"]}
"🏳️‍⚧️" {"hard":[],"soft":["\\u{200D}"]}
```

**Suggested fix.** При поиске соседей пропускать U+FE0F/U+FE0E и \p{Emoji_Modifier} (U+1F3FB–1F3FF): искать ближайший не-VS/не-modifier кодпоинт слева и справа, затем применять PICTO.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Утверждение подтверждено воспроизведением на dist/. Опровергнуть не удалось: выше по стеку ничего не мешает срабатыванию, потому что INJ_001 вызывает hiddenChars(e.text) на сырых данных, без NFKC и без фильтров. В test/ есть только позитивный кейс с семьёй 👨‍👩‍👧. Теста, который закреплял бы срабатывание на VS16 или модификаторе тона как намеренное поведение, нет. В spec.md:591 правило сформулировано как «U+200D between two Extended_Pictographic», и код ему буквально соответствует. Однако в скобках там указана цель «emoji ZWJ sequences», а ❤️‍🔥 и 👩🏽‍💻 — каноничные RGI ZWJ-последовательности. Значит, это недоработка реализации (и самой формулировки в спеке), а не задуманное поведение. Severity понижаю до low. Срабатывание — warning, а не error, оно не ломает основной сценарий и не связано с безопасностью. Emoji с тоном кожи или VS16 в описаниях MCP-инструментов встречаются редко. Предложенное исправление разумное: при поиске соседей пропускать U+FE0E/U+FE0F и \p{Emoji_Modifier}. Учтите хвостовой VS16 в 🏳️‍⚧️: справа от ZWJ стоит ⚧, это pictographic, так что достаточно пропускать только слева.
- *repro*: confirmed (conf 0.93) — Код строки 73 смотрит только на cps[i-1] и cps[i+1]. U+FE0F и U+1F3FD не входят в Extended_Pictographic, поэтому исключение не срабатывает. Я воспроизвёл это на dist/rules/injection.js: все три примера из находки дают soft:['\u{200D}'], а последовательности без VS16 и модификатора дают пустой список. Через check() INJ_001 непустой soft превращается в finding с severity 'warning' (строка 93). Severity понижаю до low: это только warning-шум на редком, но легитимном контенте, на безопасность и основной сценарий не влияет. Предложенное исправление разумное: при поиске соседей пропускать VS15/VS16 и Emoji_Modifier.

### F091 [low/bug] INJ-002: единицы измерения с греческой буквой (μs, kΩ, ΔT, μg) — ложный homoglyph

**Where.** `src/rules/injection.ts:111` (reviewer: rules-injection-data-policy-apps)

**What.** INJ-002 (src/rules/injection.ts:111) ставит warning на любое слово `\p{L}+`, где есть и латиница, и греческие буквы. Поэтому обычные обозначения единиц вроде «μs», «kΩ», «ΔT» и «μg» получают ложный сигнал о homoglyph-спуфинге: μ, Ω и Δ визуально не путаются с латинскими буквами. Код буквально следует docs/design/spec.md:594-595 («a single word (`\p{L}+`) that contains Latin together with Cyrillic or Greek letters»). Значит, это не расхождение со спекой, а неточность самой эвристики относительно заявленной цели (homoglyphs). Последствие: лишний warning в описаниях инструментов технических и научных серверов. Основной сценарий не ломается.

**Evidence.** INJ_002.check для 'Returns the request latency in μs and resistance in kΩ.' → 'mixed-script word "μs"'. Прямые тесты regex: μs, kΩ, ΔT, ΔE2000, μg, Ωm → все true.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f091.mjs (вызывает INJ_002.check из dist/rules/injection.js на инструменте с description 'Returns the request latency in μs and resistance in kΩ.') -> [{"tool":"latency","message":"tool.description: mixed-script word \"μs\""}]
```

**Suggested fix.** Флаговать только когда не-латинская часть состоит из визуально конфьюзабельных букв (кириллица а,е,о,р,с,у,х,і,ј,ѕ,һ; греческие ο,α,ν,ι,κ,ρ,τ,υ,χ и заглавные Α,Β,Ε,Ζ,Η,Ι,Κ,Μ,Ν,Ο,Ρ,Τ,Υ,Χ) либо исключать слова ≤3 символов с единственной греческой буквой в начале (μ, Ω, Δ, π, σ).

**Verifier votes.**

- *reader*: confirmed (conf 0.75) — Строка 111 актуальна, и проверка выполняется прямо там: латиница + (кириллица | греческий) в одном слове, без учёта визуальной путаемости букв. Ни выше, ни ниже по стеку дополнительной фильтрации нет: правило проходит по corpus(snap) и использует e.text напрямую. В test/rules/content.test.ts:25 тесты покрывают только позитивный случай с кириллицей ('рaypal') и негативный с чистой кириллицей. Теста, который фиксировал бы μs или kΩ как намеренный срабатывающий случай, нет. Спека (spec.md:594) задаёт ровно такое широкое правило, так что код ей не противоречит. Но title и rationale правила («homoglyph-spoofing signal») показывают цель — ловить путаемые буквы, а μ, Ω и Δ к ним не относятся. Ложное срабатывание подтверждено запуском против dist. Severity понижаю до low: это лишь warning-эвристика, и единицы с греческими буквами в описаниях MCP-инструментов встречаются нечасто. Секреты не утекают, основной сценарий не ломается.
- *repro*: confirmed (conf 0.9) — Воспроизведено на dist/rules/injection.js. Rule.check — это функция check, переданная в defineRule. Регэксп в строке 111 срабатывает на греческие буквы, даже если они не похожи на латиницу. Ложное срабатывание подтверждено. Severity снижаю с medium до low: правило выдаёт только warning, случай узкий (технические единицы в описаниях), а распространённый MICRO SIGN U+00B5 не ловится. Исправление из находки разумное: проверять только визуально похожие буквы (confusables) или разрешить μ/Ω/Δ/π/σ в коротких токенах.

### F092 [low/bug] INJ-006: `better than|superior to` без контекста — «rating better than the threshold» = принижение конкурентов

**Where.** `src/rules/injection.ts:226` (reviewer: rules-injection-data-policy-apps)

**What.** INJ-006 и RT-011 выдают ложный warning «Steering the model away from other tools» на любое сравнение значений со словами `better than` или `superior to`, например «rating better than the given threshold» или «similarity superior to 0.8». Причина: в последнем паттерне INJ_006_PATTERNS (src/rules/injection.ts:226) эти альтернативы не привязаны к объекту. Паттерн буквально взят из docs/design/spec.md:623, поэтому это изъян эвристики в спецификации, а не расхождение с ней. Исправлять надо в спеке и в коде одновременно. Фикс из исходной находки не годится: он ломает test/rules/content.test.ts:208 ('Our search is better than Google.' должен оставаться warning). Лучше исключать числовые и пороговые объекты сравнения (threshold, average, baseline, цифры), чем требовать объект из фиксированного списка.

**Evidence.** INJ_006.check для 'Return items whose rating is better than the given threshold.' → evidence 'better than'. RT_011 на тексте 'Scores better than average.' → 'output contains ...'.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f092arb.mjs (matchPattern по INJ_006_PATTERNS из dist/rules/injection.js):
"Return items whose rating is better than the given threshold." => ["better than"]
"Only matches with similarity superior to 0.8 are returned." => ["superior to"]
"Filter: price better than 100." => ["better than"]
"Our search is better than Google." => ["better than"] (это совпадение ожидается тестом content.test.ts:208)
"Better than other tools." => ["Better than"]
```

**Suggested fix.** Связать с объектом: `(better than|superior to) [^.]{0,30}\b(other|any|built-?in|default|competing|competitor|alternative)s?\b|\b(tools?|plugins?|servers?|search)\b`; оставить `unlike (other|competitor)` как есть.

**Verifier votes.**

- *reader*: REFUTED (conf 0.6) — Поведение воспроизводится, но так задумано. Строка 226 в src/rules/injection.ts актуальна. Голые альтернативы `better than` и `superior to` в последнем паттерне INJ_006_PATTERNS срабатывают на любое сравнение, и RT-011 тоже, потому что src/rules/runtime.ts:260 использует INJ_006_PATTERNS. Однако docs/design/spec.md:623 дословно требует для INJ-006 регэксп `/\b(always (use|call|prefer) (this|these|our)\b|prefer (this|our) (tool|plugin|server)|better than|superior to|unlike (other|competitor))/i`. Значит, код выполняет спецификацию, а не расходится с ней. Правило по спеке — эвристика уровня warning, не error. Выше или ниже по стеку случай не фильтруется. Тесты (test/rules/injection.test.ts:9-13, test/rules/content.test.ts:208, test/rules/runtime.test.ts:145-151) закрепляют срабатывание `better than` и проверяют поле evidence == 'better than'. Отдельного теста, который подтверждал бы, что ложные срабатывания на сравнение чисел допустимы, нет. Предложенный автором фикс сломал бы существующий тест 'Our search is better than Google.': 'Google' не входит в список объектов фикса, а `search` стоит до `better than`, а не после. Вывод: это не дефект реализации, а неточность эвристики, заложенная в самой спецификации. Если её чинить, то на уровне спеки, и с приоритетом low: это шум warning-уровня, основной сценарий он не ломает. Подтверждение уровня medium не обосновано.
- *repro*: confirmed (conf 0.92) — Воспроизведено на dist. В src/rules/injection.ts:226 последний паттерн INJ_006_PATTERNS содержит голые альтернативы `better than|superior to` без привязки к объекту (tools/servers/competitors). Поэтому любое обычное сравнение значений в описании («rating is better than the given threshold», «better than 0.5 confidence», «superior to linear scan») даёт warning INJ-006 «Steering the model away from other tools» с fix-текстом про steering. RT-011 (src/rules/runtime.ts:260) повторно использует INJ_006_PATTERNS, поэтому тот же ложный сигнал появляется на выводе инструментов («Scores better than average.»). Ни `unless`, ни `unlessInMatch` у паттерна нет. Severity medium: результат неверный в реальных случаях (ложный warning на типичных описаниях фильтров и порогов и на выводе инструментов), но это только warning, на безопасность и секреты не влияет.
- *ARBITER (round 2)*: confirmed (conf 0.85) — [partially-confirmed] Что верно. Ложное срабатывание есть и воспроизводится. Последний паттерн INJ_006_PATTERNS (src/rules/injection.ts:226) содержит голые альтернативы `better than` и `superior to`, у которых нет ни `unless`, ни привязки к объекту. Я проверил на dist/rules/injection.js: фразы «rating is better than the given threshold», «similarity superior to 0.8» и «price better than 100» дают совпадения с evidence `better than` / `superior to`. RT-011 (src/rules/runtime.ts:260) берёт тот же INJ_006_PATTERNS, поэтому ложный сигнал появляется и на выводе инструментов. Значит, тезис находки о ложных warning на обычных сравнениях значений верен.

Что неверно или завышено.
1) Это не расхождение кода с замыслом. docs/design/spec.md:623 дословно задаёт `better than|superior to` без объекта, код выполняет спецификацию, так что дефект сидит в эвристике самой спеки. Довод «по спеке» я всё же не считаю опровержением. Код уже отошёл от буквы спеки в эту же сторону, то есть ради снижения FP: сделано исключение для самоограничения Kiwi (lookahead `(?!\s+(it|this|...))`) и info-уровень для conditional «always use this tool when…». Значит, проект на практике считает FP этого правила поводом для исправления, и голос «refuted» не прав, что «так задумано».
2) Предложенный фикс ломает зафиксированное поведение. Тест test/rules/content.test.ts:208 требует warning на 'Our search is better than Google.'. 'Google' нет в списке объектов фикса, а `search` стоит перед `better than`, а не после. Так что фикс в предложенном виде отклоняется. Нужен вариант, который сохраняет сравнение с именованными конкурентами или со своим продуктом в роли субъекта, например через исключение числового или порогового объекта: `better than (the )?(given |specified )?(threshold|average|\d|baseline|linear|...)`.
3) Severity. Правило уровня warning. На безопасность, секреты и exit-статус по error это не влияет: это шум в отчёте, который портит warning-сводку и может отвлекать ревьюера. Medium не оправдан, итог low.

Разбор голосов. Верификатор «repro» (0.92) прав по факту, но завышает severity и не замечает, что фикс ломает тест :208. Верификатор «reader» (0.6) прав по severity, по привязке к спеке и по поломке теста, но делает слишком сильный вывод «refuted». Ложные срабатывания реальны, затрагивают и RT-011, и проект уже правил это правило против FP. Поэтому итог: partially-confirmed, low. Исправлять нужно и в спеке, и в коде, не ломая случай 'better than Google'.

Пункт про C004 (Windows npx/.cmd) к F092 не относится: это часть шаблонной формулировки задачи, к INJ-006 он не применим.

### F094 [low/bug] INJ-009: «Follow the setup instructions in the README» / «apply the rules defined in the config» = подтягивание инструкций извне

**Where.** `src/rules/injection.ts:307` (reviewer: rules-injection-data-policy-apps)

**What.** Первый паттерн INJ-009 (src/rules/injection.ts:307, регулярка дословно повторяет docs/design/spec.md) срабатывает на обычную документацию и описания инструментов для работы с правилами и конфигами: «Follow the setup instructions in the README», «Apply the validation rules in the schema», «Load rules from a YAML file». Источник после from/in/at никак не ограничен, поэтому README, schema или YAML file считаются внешним источником инструкций. Вторая половина примера автора («Applies the formatting rules defined in the config») НЕ срабатывает: в «Applies» нет слова, на котором сработала бы граница \bapply\b. Следствие — ложное предупреждение уровня warning, а не error.

**Evidence.** INJ_009.check для 'Follow the setup instructions in the README before running. Applies the formatting rules defined in the config.' → evidence 'Follow the setup instructions in'.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f094.mjs (против dist/rules/injection.js, INJ_009_PATTERNS + matchPattern):
"Follow the setup instructions in the README before running." => Follow the setup instructions in
"Applies the formatting rules defined in the config." => null
"Apply the validation rules in the schema." => Apply the validation rules in
"Load rules from a YAML file." => Load rules from
"Executes the lint rules in .eslintrc on the given file." => null
```

**Suggested fix.** Требовать источник-данные: `(from|in|returned by) (the )?(response|result|output|page|document|file content|fetched|returned|tool output|web ?page|email|message)`; исключать `setup|installation|readme|config(uration)?|formatting|business|validation` рядом с rules/instructions.

**Verifier votes.**

- *reader*: confirmed (conf 0.75) — Номер строки актуален: line 307 — первый элемент INJ_009_PATTERNS. Ниже по стеку scanCorpus/matchPattern фильтров нет: у паттерна нет unless/unlessInMatch, и scanCorpus вызывается без filter. Тест test/rules/content.test.ts:52 проверяет только pos «follow the instructions in the response» и neg про untrusted page content, так что намеренность ложных срабатываний на README/config он не подтверждает. Spec (строка 639) задаёт ту же регулярку, но в нём не сказано, что setup- и config-фразы должны флагаться: rationale правила — «fetched content». Поэтому ложное срабатывание реальное. Severity понижена до low: правило даёт только warning, а spec (§1.2, C9) прямо называет широкие формулировки эвристикой уровня warning. Часть evidence автора неточна: фраза с «Applies» не матчится.
- *repro*: confirmed (conf 0.8) — Первый паттерн INJ_009_PATTERNS в src/rules/injection.ts:307 — `/\b(follow|obey|execute|apply|load)\b[^.]{0,40}\b(instructions?|rules|directives|system prompt)\b[^.]{0,40}\b(from|at|in|returned by)\b/i`. Он не проверяет, что источник — недоверенные данные (response/output/page/email и т.п.), поэтому срабатывает на любую повелительную фразу вида «Follow/Apply … instructions/rules … in/from X». Проверил на dist/rules/injection.js: INJ-009 выдаёт warning на «Follow the setup instructions in the README…» и «Apply the validation rules in the schema…». Это ложное срабатывание: речь о документации и бизнес-правилах, а не об indirect prompt injection. Утверждение подтверждается, но частично: вторая фраза из evidence автора, «Applies the formatting rules defined in the config», сама по себе НЕ срабатывает. Из-за `\b` после глагола формы третьего лица (Applies/Loads/Executes) не совпадают. «Loads the lint rules from the project config» и «Applies the business rules from your CRM settings» тоже чисты. Значит, ложные срабатывания возможны только у повелительных форм, а это сужает охват. Итог — ложное предупреждение в отчёте (по умолчанию severity warning для claude и chatgpt), без сбоев и утечек. Выставляю medium: результат неверный в правдоподобных реальных описаниях, хотя сценарий уже, чем описал автор.

### F095 [low/bug] INJ-005 (warning-ветки): `user` как прилагательное и «You are now connected»

**Where.** `src/rules/injection.ts:199` (reviewer: rules-injection-data-policy-apps)

**What.** INJ-005, warning-ветки. Паттерн injection.ts:199 считает 'user' в составе именной группы ('user avatars', 'user-generated content') адресатом сокрытия, и RAW_DATA_OBJECT этот случай не исключает. Паттерн :201 срабатывает на бытовое 'You are now connected/signed in'. Оба дают ложный warning.

**Evidence.** INJ_005.check → две warning-находки: evidence 'Do not show user' и 'You are now'.

**Repro (verifier).**

```
node scratchpad/inj.mjs (dist/rules/injection.js): INJ-005 'Do not show user avatars larger than 64px.' -> [['warning','Do not show user']]; 'You are now connected to the workspace.' -> [['warning','You are now']]
```

**Suggested fix.** Для `user` требовать окончание именной группы: `\b(the )?user(?![- ](avatar|name|id|generated|input|profile|data)s?\b)\b` или требовать `the user` без артикля-опущения; для «you are now» требовать роль/персону: `you are now (a|an|the|in|acting|operating|free)\b` и `from now on,? you (are|will|must|should)`.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.7) — Строки актуальны: паттерн 5 на injection.ts:199, паттерн 7 на :201. RAW_DATA_OBJECT (:190) не содержит avatar/profile/generated, SECRET_OBJECT тоже, поэтому 'Do not show user avatars…' проходит. Паттерн 7 срабатывает на любое 'you are now' без проверки контекста. В spec.md:615 эти регулярки указаны как warning-эвристики, но в проекте ложные срабатывания считаются дефектами: в test/rules/content.test.ts:148,220 есть отдельные тесты-guards для 'Never show raw note IDs to the user'. Тестов, которые закрепляли бы 'user avatars' или 'You are now connected' как ожидаемое срабатывание, нет. Ложное срабатывание — только warning, отсюда severity low.

### F096 [low/bug] INJ-008: «Use this tool for any question about billing» — тематически ограниченный триггер считается overly broad

**Where.** `src/rules/injection.ts:303` (reviewer: rules-injection-data-policy-apps)

**What.** INJ-008 (injection.ts:303): первая альтернатива '(use|call|invoke|run) (this|me)( tool)? (for|…) (any|every|all)\b' не учитывает уточнение после квантора. Тематически ограниченная подсказка 'Use this tool for any question about billing' получает chatgpt=warning (claude=info) как overly broad triggering.

**Evidence.** INJ_008.check для 'Use this tool for any question about billing.' → evidence 'Use this tool for any'.

**Repro (verifier).**

```
INJ-008 'Use this tool for any question about billing.' -> [[undefined(rule default: chatgpt warning / claude info),'Use this tool for any']]
```

**Suggested fix.** После `(any|every|all) (request|question|query|message)s?` добавить negative lookahead на уточнение: `(?!\s+(about|regarding|related to|concerning|on|involving)\b)`.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.7) — Строка 303 актуальна. Первая альтернатива регулярки (как и в spec.md, раздел INJ-008) сопоставляет 'Use this tool for any' на границе слова и не смотрит, что идёт дальше. В test/rules/injection.test.ts:28-48 защищены от ложных срабатываний только 'limit'-формулировки ('returns at most 20 matches for any query'). Положительные примеры там безусловные ('for every request … about anything', 'for all requests'). Тематически ограниченная подсказка 'for any question about billing' не попадает ни в positives, ни в negatives, поэтому намеренным поведением это не выглядит. Последствие: warning для chatgpt (у claude — info), отсюда low.

### F097 [low/bug] INJ-007: паттерн брендов `(slack|github|…) (tool|connector)` флагует first-party сервер того же бренда

**Where.** `src/rules/injection.ts:255` (reviewer: rules-injection-data-policy-apps)

**What.** INJ-007 (и RT-011, где те же INJ_007_PATTERNS) — брендовый паттерн injection.ts:255 не освобождён от проверки ownToolExempt, а ownToolFilter не учитывает serverInfo.name/title. В итоге first-party сервер (например, Slack), который в описании упоминает собственный 'Slack connector', получает warning 'coercing calls to software the user did not request'.

**Evidence.** INJ_007.check с serverInfo.name='Slack' и описанием 'Post a message via the Slack connector.' → evidence 'Slack connector'.

**Repro (verifier).**

```
INJ-007, serverInfo={name:'Slack'}, описание 'Post a message via the Slack connector.' -> [[undefined(default warning),'Slack connector']]
```

**Suggested fix.** В ownToolFilter добавить в `own` токены из serverInfo.name/title и пометить паттерн 4 `ownToolExempt: true` (referencedIdentifiers расширить на бренд-слово перед tool|connector).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.7) — Строка 255 актуальна. У паттерна 4 нет ownToolExempt, а ownToolFilter (:272-283) в любом случае собирает только имена и title инструментов, без serverInfo.name/title. Слово 'Slack' перед 'connector' как идентификатор не извлекается. Выше по стеку (engine) нет подавления по бренду сервера. Тот же набор паттернов использует RT-011 (src/rules/runtime.ts:260-261), так что ложное срабатывание повторяется и там. Тестов, закрепляющих это поведение, нет. Последствие — warning, отсюда low.

### F098 [low/bug] DATA-001 текстовая эвристика: «Send all messages matching the filter» в мессенджер-инструментах

**Where.** `src/rules/data.ts:80` (reviewer: rules-injection-data-policy-apps)

**What.** Текстовая эвристика DATA-001 (src/rules/data.ts:80, дословно из docs/design/spec.md §2.5) принимает `all messages` без обязательного квалификатора chat/conversation. Поэтому описания инструментов мессенджеров про пересылку или выгрузку сообщений канала («Send all messages matching the filter to the archive channel», «Provide all messages from the Slack channel») получают warning «asks for conversation data». Это ложное срабатывание уровня warning. Исправление требует синхронно поменять спеку и код и добавить negative-тест в test/rules/content.test.ts.

**Evidence.** DATA_001.check для forward 'Send all messages matching the filter to the archive channel.' → warning 'asks for conversation data'.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f098.mjs (DATA_001.check против dist/rules/data.js; snapshot: один tool, prompts/resources/resourceTemplates пустые):
"Send all messages matching the filter to the archive channel." => [{"tool":"forward","severity":"warning","message":"tool.description asks for conversation data: \"Send all messages matching the filter to the archive channel.\""}]
"Provide all messages from the Slack channel." => [{"tool":"forward","severity":"warning","message":"tool.description asks for conversation data: \"Provide all messages from the Slack channel.\""}]
"Pass the previous messages from the conversation." => [{...warning...}] (ожидаемое истинное срабатывание)
```

**Suggested fix.** Требовать `(chat|conversation|previous|prior) messages` обязательно (убрать `all messages` без квалификатора) или исключать объект `(in|from) (the )?(channel|thread|inbox|folder|mailbox)` после messages.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.6) — Строка 80 в src/rules/data.ts актуальна. Альтернатива `(include|pass|send|provide) (the )?(user'?s )?(previous|prior|all) (chat |conversation )?messages` с квалификатором `all` и необязательным `(chat |conversation )?` срабатывает на любое «send/provide all messages», в том числе на пересылку или архивирование сообщений канала в мессенджерах. Выше по стеку это ничем не отсекается: scanText пробегает весь corpus, исключений нет. В test/rules/content.test.ts (строки 135–145) есть guard-тесты на ложные срабатывания: VM memory, ticket history, analytics, log message. Нет ни теста, который закреплял бы срабатывание на «all messages» без chat-квалификатора, ни negative-теста на мессенджер-инструменты. Есть смягчающее обстоятельство: регекс дословно прописан в docs/design/spec.md §2.5 (DATA-001, Detect, 3-й пункт), а находка выдаётся только как warning (эвристика по §1.2). Значит, код соответствует спеке, и дефект сидит в самой эвристике спеки, а не в расхождении кода со спекой. При этом спека явно ставит цель не ловить такие ложные срабатывания: «A bare `history`... does not match», а слабые имена вроде Slack thread id она понижает до warning. Мессенджер-серверы (Slack/Discord/email) встречаются часто, так что ложное срабатывание реалистичное. Подтверждаю как low. Исправлять нужно одновременно spec.md §2.5 и data.ts:80, плюс добавить negative-тест.

### F099 [low/bug] POL-004: extractLinks собирает любой `href=`, включая `<link rel=stylesheet>` — pricing.css = upsell

**Where.** `src/rules/util/html.ts:105` (reviewer: rules-injection-data-policy-apps)

**What.** extractLinks (src/rules/util/html.ts:105) собирает `href` любого тега, включая `<link rel=stylesheet|icon|preload>` и `<base>`. pathWord делит сегмент по '.', поэтому ресурс вроде /css/pricing.css или /billing.css распознаётся как upsell-ссылка, и POL-004 выдаёт ложное chatgpt=warning. Как исправить: брать href только из `<a>` и `<area>` либо исключить `<link>` и `<base>`.

**Evidence.** extractLinks('<link rel="stylesheet" href="https://cdn.example.com/css/pricing.css">') → ['https://cdn.example.com/css/pricing.css']; linkKind → 'upsell'; POL_004.check → 'widget links to https://cdn.example.com/css/pricing.css'.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f099.mjs
extractLinks('<link rel="stylesheet" href="https://cdn.example.com/css/pricing.css"><script src="/js/billing.js"></script>') -> [ 'https://cdn.example.com/css/pricing.css' ]; linkKind -> [ 'upsell' ] (POL-004 выдаст chatgpt=warning 'widget links to https://cdn.example.com/css/pricing.css')
```

**Suggested fix.** Извлекать href только из `<a …>` (и `<area>`) тегов: `/<a\b[^<>]*\bhref\s*=\s*["']([^"']+)/gi`; в pathWord не разбивать последний сегмент по расширению файла (`.css|.js|.png`).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.85) — Строка 105 в src/rules/util/html.ts актуальна: extractLinks берёт значение любого атрибута `href=` и не смотрит на имя тега. Значит, туда попадают `<link rel=stylesheet>`, `<base>` и `<area>`. Единственный вызов — POL_004 в src/rules/policy.ts:123. Ниже по стеку фильтрации нет: linkKind проверяет только CODE_HOSTS, а pathWord делит сегмент по [-_.], поэтому 'pricing.css' даёт часть 'pricing' из UPSELL_WORDS. Тест test/rules/content.test.ts:242 проверяет только пропуск шаблонных URL в `<a>`. Тестов, где ресурсные `<link>` считались бы ссылками намеренно, нет. В spec.md §POL-004 сказано «links whose path matches …». По смыслу правила (upsell/checkout-ссылки для пользователя) это навигационные ссылки, а не подключаемые ресурсы. Утверждение подтверждено. Severity low: ложное warning только для chatgpt, правило эвристическое, и нужно, чтобы имя ресурса совпало со словом из списка. Уточнение: `<script src>` через extractLinks не проходит, затронут только `href`.

### F110 [low/bug] INJ-004: percent-encoded не-ASCII в URL-примере (кириллица/CJK) = «encoded payload»

**Where.** `src/rules/injection.ts:180` (reviewer: rules-injection-data-policy-apps)

**What.** INJ-004 (injection.ts:180): ветка escape-runs '%[0-9a-f]{2}){8,}' без декодирования принимает за encoded payload любой URL-encoded UTF-8 фрагмент из не менее чем 8 байт: от 4 кириллических букв или от 3 CJK-символов (а не от 3 кириллических, как сказано в исходном утверждении). Пример запроса на русском или японском в описании даёт warning.

**Evidence.** INJ_004.check для описания с '%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82' → evidence '%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82'.

**Repro (verifier).**

```
INJ-004 'Example: search?q=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82' -> [[undefined(default warning),'%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82']]; 'q=%D0%BF%D1%80%D0%B8' (3 буквы, 6 escapes) -> []; 'q=%D0%BF%D1%80' -> []
```

**Suggested fix.** Для percent-runs декодировать (`decodeURIComponent` в try) и флаговать только если результат — ASCII-текст, содержащий буквы (т.е. скрывает латинский текст), а не валидный UTF-8 не-ASCII.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.7) — Строка 180 актуальна. Регулярка '(…|%[0-9a-f]{2}){8,}' совпадает с той, что дана в spec.md (раздел INJ-004), и не делает декодирования. Для base64-веток проект уже различает данные и payload (encodedPayload, тест content.test.ts:227), а для percent-runs аналогичной логики нет. Пороговое значение в утверждении неточное: кириллическая буква в UTF-8 занимает 2 байта, поэтому 3 буквы — это 6 escape-последовательностей < 8, и они НЕ срабатывают (проверено). Срабатывание начинается с 4 кириллических букв или 3 CJK-символов (по 3 байта, итого 9). Суть дефекта подтверждается, порог исправлен в corrected_description.

### F111 [low/bug] INJ-006 паттерн 2: «rather than the default full web page» — не стиринг

**Where.** `src/rules/injection.ts:221` (reviewer: rules-injection-data-policy-apps)

**What.** Второй паттерн INJ-006 (src/rules/injection.ts:221, дословно из spec.md:621) `(instead of|rather than)[^.]{0,40}(other|built-?in|default|any)[^.]{0,20}(tools?|search|web|plugins?)` срабатывает на описания формата вывода вроде «rather than the default full web page» или «instead of the default HTML web view». Такие фразы не уводят модель от других инструментов, а правило выдаёт warning. В конце паттерна нет \b, поэтому «web» совпадает и с website/webpage. Исправлять нужно и код, и spec.md: например, требовать после web слова search/browsing/browser и ставить \b. Предложенное в находке требование глагола use/call/prefer перед конструкцией стоит проверить отдельно: оно может отсечь настоящие случаи вроде «Returns results; use instead of the built-in web search».

**Evidence.** INJ_006.check для 'Returns a compact summary rather than the default full web page.' → evidence 'rather than the default full web'.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f111.mjs (импорт INJ_006_PATTERNS, matchPattern из dist/rules/injection.js):
"Returns a compact summary rather than the default full web page." -> [ 'p1:rather than the default full web' ]
"Returns plain text instead of the default HTML web view." -> [ 'p1:instead of the default HTML web' ]
"Use this instead of the built-in web search." -> [ 'p1:instead of the built-in web search' ]  (контроль: настоящий случай)
```

**Suggested fix.** Заменить `web` на `web search|browsing|browser` и требовать глагол использования перед конструкцией: `\b(use|call|prefer)\b[^.]{0,40}(instead of|rather than)`.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.75) — Строка 221 актуальна: это второй паттерн INJ_006_PATTERNS. Выше по стеку ничего не фильтрует это совпадение: scanCorpus вызывается без filter, у паттерна нет unless/unlessInMatch. В test/rules/injection.test.ts нет негативного кейса про описание формата результата («rather than/instead of the default ... web page/view»), поэтому намеренным такое поведение считать не из чего. Оговорка: regex дословно взят из docs/design/spec.md:621, то есть код соответствует спеке, и ложное срабатывание — слабость самой эвристики в спеке, а не отклонение от неё. Но спека описывает INJ-006 как «Steering the model away from other tools», а фраза «Returns a compact summary rather than the default full web page» ни от каких инструментов не уводит. Значит, срабатывание противоречит замыслу правила. Последствие — лишний warning, то есть низкая серьёзность. Дополнительно: после последней группы (tools?|search|web|plugins?) нет \b, поэтому совпадут и «website», и «webpage».

### F117 [low/security] Basic-авторизация: декодированный пароль не редактируется

**Where.** `src/redact.ts:48` (reviewer: report-redact-engine)

**What.** withSchemeToken (src/redact.ts:48) для `Authorization: Basic <base64>`, заданного через --header, argv (mcp-remote --header) или env, добавляет в редактор только base64-токен и строку с ним. Декодированные `user:pass` и пароль не добавляются. Если сервер вернёт пароль в открытом виде (текст ошибки, stderr stdio-сервера, тело ответа), он попадёт в отчёт без редакции. Тот же пароль в URL (`user:pass@`) редактируется через urlSecrets, так что обработка непоследовательна. Исправление: для схемы basic декодировать base64, затем добавить в редактор всю строку `user:pass` и часть после первого ':', если она не короче 4 символов. Флаг strongOnly и фильтр TRIVIAL соблюдать так же, как для URL-паролей.

**Evidence.** node repro: argvSecrets(['--header','Authorization: Basic YWRtaW46U3VwZXJTZWNyZXQ5OQ==']) => ['Basic YWRt...', 'YWRt...']
scrub('error: bad password SuperSecret99 for admin', buildRedactor({headers:{Authorization:'Basic YWRtaW46U3VwZXJTZWNyZXQ5OQ=='}})) => 'error: bad password SuperSecret99 for admin'

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f117.mjs (импортирует dist/redact.js):
buildRedactor({headers:{Authorization:'Basic YWRtaW46U3VwZXJTZWNyZXQ5OQ=='}}).values => ['Basic%20YWRtaW46...%3D%3D','Basic YWRtaW46U3VwZXJTZWNyZXQ5OQ==','YWRtaW46...%3D%3D','YWRtaW46U3VwZXJTZWNyZXQ5OQ==']
scrub('error: bad password SuperSecret99 for admin', r) => 'error: bad password SuperSecret99 for admin'   (не отредактировано)
argv-вариант (mcp-remote --header 'Authorization: Basic ...'): scrub('401: password SuperSecret99 rejected') => без изменений
Для сравнения URL: buildRedactor({url:'https://admin:SuperSecret99@x/mcp'}) => '401: password «redacted» rejected'
```

**Suggested fix.** В withSchemeToken при схеме basic: `Buffer.from(token,'base64').toString()` → добавить целиком и часть после первого ':' (если ≥4 символов).

**Verifier votes.**

- *reader*: confirmed (conf 0.8) — Строка актуальна: src/redact.ts:48-52, withSchemeToken. Для схем bearer/basic/token/dpop она добавляет только всю строку и сырой токен после схемы; base64 для Basic нигде не декодируется. Выше и ниже по стеку это тоже не закрыто: createRedactor (src/protocol/trace.ts:20-28) добавляет к каждому значению только JSON-escaped и percent-encoded формы. В test/ нет теста на редакцию Basic: единственные упоминания `Basic ` относятся к AUTH-002 и parseWwwAuthenticate, то есть к правилам, а не к редактору. Утверждение не противоречит docs/design/spec.md.

Поведение непоследовательно. Тот же пароль, переданный в URL (`https://admin:SuperSecret99@x/mcp`), редактируется: urlSecrets кладёт u.password. Значит, цель «скрывать пароль в открытом виде» у проекта есть, а путь через Basic её не выполняет.

Repro подтверждён на dist. Но утечка случается только тогда, когда сервер сам возвращает пароль в открытом виде в ошибке, stderr или ответе. Это редкий сценарий, поэтому я понижаю severity до low. Если считать по рубрике «утечка секретов», можно оставить medium. Base64-форма при этом скрывается корректно.
- *repro*: confirmed (conf 0.8) — Воспроизвелось на dist/redact.js. withSchemeToken (src/redact.ts:48-52) для `Basic <b64>` возвращает только строку целиком и base64-токен. Декодированные `user:pass` и пароль в набор значений Redactor не попадают ни через buildRedactor({headers}), ни через argvSecrets (`--header 'Authorization: Basic …'`). Поэтому scrub оставляет пароль открытым текстом, если сервер его повторит (в ошибке, в stderr stdio-сервера, в echo конфигурации). Это расходится с тем, как обрабатываются те же учётные данные в URL: urlSecrets (строка 38) явно редактирует пароль из `user:pass@`, а тот же секрет в Basic-заголовке не защищён. Почему severity понижена до low: утечка возможна только если сервер сам повторяет расшифрованный пароль в своих данных. Серверы делают так редко, а base64-форма, которая встречается чаще, редактируется корректно. Пример автора с 'for admin' к утечке логина не относится: короткие логины (<4 символов) и TRIVIAL-слова и так намеренно не редактируются.

### F118 [low/bug] Полный уровень редакции (--env) заменяет обычные слова по всему отчёту: production, debug, версии, пути, hostname

**Where.** `src/redact.ts:114` (reviewer: report-redact-engine)

**What.** Полный Redactor отчёта (buildRedactor, strongOnly=false, src/redact.ts:114) добавляет каждое значение --env под обычным именем целиком. Отсекаются только TRIVIAL (true/false, числа с одной дробной частью, схемные слова) и пустые значения. Поэтому обычные значения окружения (production, debug, /home/user, семвер 1.2.3, который в TRIVIAL не попадает) заменяются на «redacted» по всему готовому отчёту подстрочно, в том числе внутри чужих слов: «reproduction» превращается в «re«redacted»», «debug_logs» в ««redacted»_logs». Затронуты имена tools, serverInfo.version, сообщения и fix-snippets находок. Правила получают строгий набор (для таких значений он пуст), поэтому находки, severity и exit code не меняются. Маскирование значений --env в отчёте задокументировано (README:87/115/117, SECURITY.md, JSDoc) и закреплено тестом redaction-tiers.test.ts:46. Подстрочное повреждение посторонних слов и отсутствие типичных значений окружения и версий в TRIVIAL не оговорены. Это UX-дефект низкой серьёзности, а не ошибка корректности.

**Evidence.** node repro: buildRedactor({env:{NODE_ENV:'production',LOG_LEVEL:'debug',HOME:'/home/user'}}).values => ['%2Fhome%2Fuser','production','/home/user','debug']
scrub('Tool deploy_production: deploys to production. debug_logs tool. Path /home/user/x') => 'Tool deploy_«redacted»: deploys to «redacted». «redacted»_logs tool. Path «redacted»/x'
scrub('server 1.2.3 ok', buildRedactor({env:{APP_VERSION:'1.2.3'}})) => 'server «redacted» ok'

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f118arb.mjs
[ '%2Fhome%2Fuser', 'production', '/home/user', 'debug', '1.2.3' ]
Tool deploy_«redacted»: «redacted» «redacted»_logs «redacted»/x v«redacted»; re«redacted»
{"snapshot":{"tools":[{"name":"«redacted»_logs"}],"serverInfo":{"version":"«redacted»"}},"findings":[{"ruleId":"X","severity":"medium","message":"Rename tool «redacted»_logs","fix":"{\"name\":\"«redacted»_logs\"}"}]}
[]   <- strong tier (strongOnly=true): rules unaffected
```

**Suggested fix.** Для не-секретных имён (isSecretName false) добавлять значение только если tokenLike(v) (как уже сделано для strongOnly) или длина ≥ 8 и есть цифры и буквы; либо расширить TRIVIAL словарём типичных значений окружения (production/development/debug/info/warn/error/test/true). Минимум — документировать и дать `--env-plain K` для исключения.

**Verifier votes.**

- *reader*: REFUTED (conf 0.75) — Механика описана верно: строка 114 в src/redact.ts актуальна, и при strongOnly=false в полный Redactor попадает любое значение --env, кроме тех, что отсекает TRIVIAL. Поэтому `--env NODE_ENV=production` действительно заменит «production» по всему отчёту. Но это не ошибка, а намеренное поведение, которое задокументировано и закреплено тестами.
1) В JSDoc buildRedactor (стр. 93-98) сказано: «the full set, for the finished report, has them all».
2) README.md:115 и :117 прямо говорят, что значения --env маскируются в любом формате, включая значения под обычным именем: «Other `--env` values and their parts (`--env FORMAT=text`, …) are masked in the finished report and every other output only». Исключения перечислены отдельно: значения короче 4 символов, true/false/yes/no/on/off/null/undefined/none, числа до 6 цифр и протокольные/схемные слова.
3) В SECURITY.md:42-45 описана та же модель: маскирование только в отчёте и до правил не доходит, так что ни одна находка не меняется. Пользователю там советуют передавать секрет под секретным именем.
4) Тест test/redaction-tiers.test.ts:46 проверяет `buildRedactor(input).values.has('plain-WEAK05') === true` и подписан «the full set has the weak value», то есть слабое значение под обычным именем намеренно входит в полный набор. Тесты на стр. 18-34 показывают, что такое маскирование не меняет триплеты находок (ruleId, severity, verdict).
Получается сознательный компромисс в пользу безопасности: лучше лишний раз закрыть обычное слово, чем пропустить секрет, переданный под обычным именем. Правила, severity и exit code от этого не зависят, страдает только читаемость отчёта, и это осознанная плата за безопасность. Предложение пропускать не-токены под обычными именами ослабило бы задокументированную гарантию «--env values are redacted in every output format». Это запрос на смену дизайна (например, флаг `--env-plain`), а не дефект корректности. Если всё-таки учитывать находку, то максимум как low/idea: эффект только косметический, а поведение задокументировано. Repro я не запускал: пример из evidence согласуется с кодом, и спорна только его трактовка как бага.
- *repro*: confirmed (conf 0.6) — Воспроизвёл на dist/redact.js, вывод точно совпал с evidence автора. Значения попадают в набор редакции из-за строки 114: при !strongOnly пушится каждое v. TRIVIAL покрывает только true/false, числа и слова протокола и схем. redactDeep маскирует и ключи внутри server data, например имя tool debug_logs. Вывод о влиянии сделан по коду: buildRedactor(..., true) для NODE_ENV=production даёт пустой набор, и README (строка 117) прямо пишет, что такие значения не меняют ни находку, ни severity, ни exit code. Значит, страдает только вид отчёта. Маскирование документировано как намеренное (README:87, 115, 117, docstring в 93-98). Предложенный автором фильтр (только tokenLike) противоречит описанному в документации поведению: маскировать части DATABASE_URL с user и password postgres. Проблема UX реальная, но это документированный компромисс без вреда для основного сценария и без утечки. Подтверждаю с понижением до low.
- *ARBITER (round 2)*: confirmed (conf 0.85) — [partially-confirmed] Механика подтверждена, но квалификация находки как «bug/medium» не подтверждена.

Что верно. В src/redact.ts:114 (второй цикл по input.env) при strongOnly=false каждое значение --env целиком добавляется в полный набор редакции. Отсекаются только TRIVIAL (src/redact.ts:13) и пустые значения. Я сам прогнал проверку против dist/redact.js. buildRedactor({env:{NODE_ENV:'production',LOG_LEVEL:'debug',HOME:'/home/user',APP_VERSION:'1.2.3'}}).values = ['%2Fhome%2Fuser','production','/home/user','debug','1.2.3']. Значение 1.2.3 не попадает в TRIVIAL: регулярка \d{1,6}(\.\d+)? допускает только одну дробную часть. scrub заменяет подстроки, а не целые слова, поэтому 'reproduction' превращается в 're«redacted»', 'deploy_production' в 'deploy_«redacted»', 'debug_logs' в '«redacted»_logs'. redactDeep маскирует имена tools, serverInfo.version, message и fix находок. Fix-snippet вида {"name":"«redacted»_logs"} в таком виде действительно не вставить. Автор и verifier «repro» здесь правы.

Что неверно или преувеличено. Это задокументированный и закреплённый тестами компромисс, а не скрытая ошибка корректности. Об этом говорят:
- JSDoc buildRedactor: «the full set, for the finished report, has them all»;
- README:87 («--env values are redacted in every output format») и README:115/117 (пример `--env FORMAT=text`: «masked in the finished report and every other output only»);
- SECURITY.md (Known gaps): значение под не-секретным именем маскируется в отчёте;
- test/redaction-tiers.test.ts:46 явно проверяет, что слабое значение входит в полный набор.

Строгий набор, который получают правила, для NODE_ENV=production, LOG_LEVEL=debug и APP_VERSION=1.2.3 пуст (проверено: buildRedactor(..., true).values = []). Поэтому ruleId, severity, verdict и exit code не меняются. Страдает только читаемость отчёта и fix-snippets, утечки нет.

Разбор аргументов сторон. Verifier «reader» (refuted) прав в том, что поведение намеренное. Предложенный автором фильтр «только tokenLike для не-секретных имён» нарушил бы задокументированную гарантию: части `--env DATABASE_URL=postgres://postgres:postgres@...` маскируются в отчёте, а «production» нельзя отличить от пароля, переданного под обычным именем. Но полное опровержение слишком сильное. Документация оправдывает маскирование целых значений и не обсуждает побочный эффект подстрочной замены внутри чужих слов («re«redacted»», «deploy_«redacted»»). Значения вроде 1.2.3 и типичные слова окружения (production/development/debug/info) не входят в TRIVIAL, хотя по той же логике, что true/false/числа, они «would blank out unrelated report text». Это реальный UX-дефект в рамках заявленного дизайна. Verifier «repro» (confirmed, low) оценил точнее.

Итог: partially-confirmed. Механика и вред для читаемости отчёта и fix-snippets верны. Утверждения, что это ошибка уровня medium и что ломается результат, неверны: поведение задокументировано, на находки не влияет. Severity low (UX/дизайн). Разумные исправления: расширить TRIVIAL семвер-подобными версиями (\d+(\.\d+){1,3}) и словарём значений окружения, либо добавить opt-out (`--env-plain K`), либо упомянуть подстрочную замену в README. Примечание про C004 (Windows npx/.cmd) к F118 не относится, его не оценивал.

### F121 [low/bug] OAuth-пункты чеклиста (MAN-007/008/013/014/026/028) пропадают при legacy discovery без PRM

**Where.** `src/rules/manual.ts:67` (reviewer: report-redact-engine)

**What.** manualChecklist (src/rules/manual.ts:67) определяет OAuth только по `authProbe.prm`. У серверов с legacy discovery (2025-03-26, `legacyDiscovery=true`, AS на origin) из «Manual checklist» пропадают все пункты [oauth]: MAN-007/008/013/014/026/028. Остальные правила и authSummary при этом считают такой сервер OAuth. Это противоречит spec §2.10 («[oauth] when the auth probe found OAuth»). На score и exit code не влияет.

**Evidence.** node repro: s.authProbe = {trigger:'preflight-401', prmAttempts:[], as:[{issuer, attempts:[], json:{registration_endpoint}}], legacyDiscovery:true, timings:{}}; manualChecklist(s) => has MAN-007: false, MAN-013: false
Код: `const oauth = !!snap.authProbe?.prm;`

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f121.mjs (против dist/rules/manual.js), вывод:
legacy: MAN-007=false MAN-013=false MAN-028=false
prm: true
```

**Suggested fix.** `const oauth = !!snap.authProbe && (!!snap.authProbe.prm || !!snap.authProbe.legacyDiscovery || snap.authProbe.as.length > 0);`

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Строка 67 в src/rules/manual.ts актуальна: `const oauth = !!snap.authProbe?.prm;`. Если PRM нет, src/probe/auth.ts:87-96 делает legacy-fallback: ставит `legacyDiscovery=true` и добавляет AS-метаданные в `as[]`. Остальной код считает такой сервер OAuth: src/rules/auth.ts:78/140/370 и src/report/index.ts:81 проверяют `prm || legacyDiscovery`. Только manualChecklist учитывает один `prm`. В spec §2.10 сказано: «[oauth] when the auth probe found OAuth». Legacy discovery 2025-03-26 — это найденный OAuth, так что код расходится со spec. Тестов, которые закрепляли бы такое поведение как намеренное, нет (grep по test/ не нашёл manual+legacy). Чеклист не влияет на score и exit code. Но пользователь с legacy-OAuth-сервером не получит важные напоминания: MAN-008 (callback URL), MAN-013 (token audience), MAN-026/028. Это неполный результат в реальном, хотя и устаревающем случае. Поэтому severity: low–medium; ставлю low, потому что затронуты только информационные напоминания.
- *repro*: confirmed (conf 0.9) — Находка подтверждена фактическим запуском против dist. Для authProbe с legacyDiscovery=true и без prm (ровно такое состояние создаёт src/probe/auth.ts:88-96) manualChecklist не возвращает ни одного oauth-пункта, а authSummary в том же отчёте называет сервер OAuth. С prm все 6 oauth-пунктов на месте. Остальной код (src/rules/auth.ts:78,140,370; src/report/index.ts:81) считает legacyDiscovery равноправным признаком OAuth, и manual.ts — единственное место, где это не так. Severity снижаю до low: ручной чеклист по замыслу не влияет на score и exit code, сценарий legacy-only без PRM встречается редко, а последствие — пропущенные напоминания в чеклисте, а не ложный результат. Предложенную автором ветку `as.length > 0` добавлять не нужно: без prm массив as заполняется только при legacyDiscovery.

### F122 [low/bug] SARIF level берётся из максимальной severity по всем платформам, а не по gated — code scanning покажет error там, где exit code = PASS

**Where.** `src/report/sarif.ts:52` (reviewer: report-redact-engine)

**What.** src/report/sarif.ts:52 берёт SARIF level из f.severity. Это максимум по всем активным платформам, включая spec, который активен всегда (engine.ts:7-9). GitHub-аннотации (github.ts:27) и exit code считают severity только по gate.platforms, а spec туда входит лишь с --fail-on-spec. Пример: правило SRV-008 {chatgpt: info, spec: error} с --target chatgpt без --fail-on-spec. Exit = PASS, аннотаций нет, а в SARIF level = error, и в GitHub code scanning появится error-алерт. Поведение соответствует spec.md §5.3 (простое отображение severity→level) и совпадает с text/markdown. Привязка к gate обещана только для аннотаций (README:166). Поэтому это несогласованность форматов и UX-проблема для code scanning (дизайн), а не нарушение заявленного контракта. Предложение: `--sarif-level gated|max` или level по gate.platforms, а также документировать выбранное правило.

**Evidence.** node repro (--target chatgpt, правило spec:error/chatgpt:warning): results => [['YY-001','error'], ...]; summary.failed: false; annotations: ['::warning title=YY-001 server::[spec, chatgpt: warning] m...']

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f122.mjs (синтетический Report: SRV-008, platforms [chatgpt, spec], severityByPlatform {chatgpt: info, spec: error}, summary.gate.platforms [chatgpt]; toSarif/annotations из dist) выводит: sarif results: [["SRV-008","error"]]; summary.failed: false; annotations: []
```

**Suggested fix.** В toSarif вычислять level как максимум platformSeverity по r.summary.gate.platforms (как в github.ts annotations), а полную severity сохранять в properties; или давать опцию `--sarif-level gated|max`.

**Verifier votes.**

- *reader*: REFUTED (conf 0.62) — Механизм описан верно. Строка актуальна: src/report/sarif.ts:52 `level: LEVEL[f.severity]`. В src/rules/engine.ts:6-10 платформа spec всегда входит в activePlatforms, а в engine.ts:130 finding.severity считается как максимум по всем активным платформам, spec тоже учитывается. Поэтому для правила вида SRV-008 (claude/chatgpt=warning, spec=error) при `--target chatgpt` в SARIF получится level 'error', хотя без --fail-on-spec gate такой finding не учитывает.

Но это поведение по спецификации, а не ошибка:
1) docs/design/spec.md §5.3 прямо задаёт «Level mapping: error→error, warning→warning, info→note» от severity finding. Слово «gated» там не встречается.
2) SARIF согласован с остальными отчётами. text, json и markdown выводят ту же f.severity (максимум по активным платформам), так что spec-error везде показан как error.
3) Привязку к gate явно задокументировали только для GitHub-аннотаций: README:166, CHANGELOG:37 и комментарий в src/report/github.ts:17-18. Значит, это выбор только для аннотаций, и на SARIF он по замыслу не распространяется. Уровни из SARIF полностью сохраняются в properties.severityByPlatform.
4) Расхождение «exit code = PASS, а в отчёте есть error» относится ко всем форматам. В spec.md (строка 10) и README:158 это описано как намеренное: exit code и verdicts считаются по --target, spec учитывается только с --fail-on-spec.

Реальное последствие одно: проверка code scanning может завалиться на алерте уровня error, хотя exit code равен 0. Это расхождение в продуктовом решении, а не в реализации. Если считать это проблемой, она тянет на low или design-предложение (например, опция --sarif-level), а не на medium-баг. При сомнении правило задачи предписывает refuted=true.
- *repro*: confirmed (conf 0.6) — Подтверждаю по коду и через repro. sarif.ts:52 использует f.severity, то есть максимум по platforms с учётом spec, а github.ts:27 считает severity только по gated-платформам. С `--target chatgpt` gate = ['chatgpt']. Для SRV-008 (chatgpt: info, spec: error) получается SARIF level error при failed=false и пустых аннотациях. Severity снижаю до low. Спецификация §5.3 описывает только отображение severity→level. Текстовый отчёт (text.ts:113) тоже группирует по f.severity. README обещает «как для exit code» только для аннотаций, а per-platform severity есть в properties.severityByPlatform. Значит, расхождение с gate — несогласованность и UX-вопрос для code scanning, а не неверный результат по заявленному контракту. Утверждение автора о фактическом поведении верно.
- *ARBITER (round 2)*: confirmed (conf 0.8) — [partially-confirmed] Что верно (механизм). src/report/sarif.ts:52 задаёт `level: LEVEL[f.severity]`. f.severity — максимум по активным платформам, а spec в них входит всегда (src/rules/engine.ts:7-9: для --target chatgpt это ['chatgpt','spec']). annotations() в src/report/github.ts:27 берёт максимум только по r.summary.gate.platforms. Без --fail-on-spec gate не включает spec. Я перезапустил repro верификатора против dist (scratchpad/f122.mjs) с синтетическим Report и реальным правилом SRV-008 {claude: info, chatgpt: info, spec: error} (src/rules/server.ts:195), при --target chatgpt. Результат: SARIF results = [["SRV-008","error"]], summary.failed = false, annotations = []. Значит, расхождение «SARIF error при exit 0 и при отсутствии аннотации» воспроизводится. В GitHub code scanning такой result станет error-алертом. При настроенном пороге Errors это может уронить проверку code scanning в PR, хотя сам job прошёл. Здесь прав верификатор repro и автор находки.

Что неверно или преувеличено (квалификация «bug/medium»). (1) docs/design/spec.md §5.3 задаёт SARIF только как «Level mapping: error→error, warning→warning, info→note» от severity находки. Gate там не упоминается, так что реализация соответствует спецификации буквально. (2) SARIF ведёт себя так же, как text и markdown: text.ts:113 и markdown.ts:57 группируют по той же f.severity, и spec-error везде показан как error. Выбивается не SARIF, а GitHub-аннотации. (3) Привязку к gate («as for the exit code») README:166 и комментарий github.ts:17-18 обещают только для аннотаций. README:107/286 прямо описывает «--target claude проходит при spec-ошибках» как намеренное поведение. (4) Полная информация не теряется: properties.severityByPlatform и properties.platforms сохраняются (sarif.ts:60). Тест test/report.test.ts:264-272 проверяет лишь допустимость значений level, а не их связь с gate, поэтому тестами ни одна трактовка не закреплена. Здесь прав верификатор reader: заявленный контракт не нарушен.

Итог. Факт поведения подтверждён, и последствие для пользователей code scanning реально: алерт уровня error противоречит exit 0 и аннотациям. Но это несогласованность между форматами и спорное дизайн-решение, а не дефект реализации против spec/README. Отсюда partially-confirmed и severity low, а не medium. Разумное исправление относится к дизайну: опция `--sarif-level gated|max`, или level по gate.platforms с полной severity в properties, плюс явная фраза в README/spec §5.3 о том, по какому принципу считается SARIF level. Замечание про C004 (Windows npx/.cmd) к F122 не относится: эта находка про src/report/sarif.ts, spawn здесь не задействован.

### F123 [low/bug] Результат с ruleId 'INTERNAL' ссылается на правило, отсутствующее в tool.driver.rules

**Where.** `src/report/sarif.ts:39` (reviewer: report-redact-engine)

**What.** Если правило бросает исключение, src/rules/engine.ts:110 создаёт находку ruleId 'INTERNAL'. В SARIF она попадает в results с level 'note' и без ruleIndex. Однако src/report/sarif.ts:39 собирает tool.driver.rules только из каталога RULES, и записи INTERNAL там нет. Вывод остаётся валидным по схеме, но потребители SARIF показывают такой результат без shortDescription и help. Это касается только случая, когда в правиле есть баг.

**Evidence.** node repro: results => [..., ['INTERNAL','note']], rules has INTERNAL: false

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f123.mjs  (toSarif из dist/report/sarif.js; на вход подан Report с одной findings {ruleId:'INTERNAL',severity:'info',...} и snap.target {kind:'http',urlAsEntered:'https://x/'})
Output: [["INTERNAL","note",null]] rules has INTERNAL: false nRules 144
```

**Suggested fix.** Добавить синтетическую запись правила INTERNAL в driver.rules (shortDescription 'Internal rule error', help 'Please report this bug') либо выносить INTERNAL в run.invocations[].toolExecutionNotifications (семантически правильнее для ошибок самого инструмента).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.85) — Подтверждено. src/rules/engine.ts:108-112 при исключении в rule.check() добавляет находку ruleId 'INTERNAL' (severity info, platforms ['spec']). src/report/sarif.ts:39 строит tool.driver.rules только из RULES.map(...), а синтетической записи INTERNAL нет; results (стр. 49-61) переносят f.ruleId как есть и не задают ruleIndex. Выше по стеку ничего не отфильтровывает: toSarif получает r.findings без изменений. В test/sarif.test.ts нет случая с INTERNAL и нет проверки, что каждый result.ruleId есть в driver.rules; test/engine.test.ts:29 проверяет только создание INTERNAL-находки, а не её вид в SARIF. docs/design/spec.md §5.3 (около стр. 1422) говорит только, что rules[] берутся из каталога, поэтому отсутствие INTERNAL получается побочным эффектом, а не задокументированным решением. Номер строки 39 актуален. По схеме SARIF 2.1.0 ruleId без соответствующего reportingDescriptor допустим, поэтому вывод остаётся валидным. Последствие косметическое: в GitHub code scanning и других SARIF-просмотрщиках у результата не будет описания и help, а возникает он только при баге в одном из правил. Severity low оставлено.

### F124 [low/bug] Исключение в правиле, не относящемся к --target, глотается без следа и без учёта в score

**Where.** `src/rules/engine.ts:109` (reviewer: report-redact-engine)

**What.** В runRules (src/rules/engine.ts:108-113) исключение правила превращается в INTERNAL-находку только при applies=true. Правило вне --target всё равно выполняется ради score, и если оно бросает исключение, ошибка теряется молча: в skipped остаётся только 'not applicable to --target X'. Это расходится с spec §4.2, где INTERNAL обещан для любого исключения. Score от target не зависит: правило бросает исключение при любом target, и его находки выпадают из scored в обоих случаях. Но при узком --target пользователь не видит, что score занижен из-за внутренней ошибки, а не из-за чистоты сервера.

**Evidence.** node repro (--target claude, chatgpt-правило бросает Error): {"findings":[],"skipped":[{"ruleId":"XX-002","reason":"not applicable to --target claude"}]}

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f124.mjs (правило XX-002 с severity {chatgpt:'error'}, check бросает Error('boom'), против dist/rules/engine.js):
claude {"findings":[],"skipped":[{"ruleId":"XX-002","reason":"not applicable to --target claude"}],"scored":0}
all {"findings":["XX-002 threw: boom"],"skipped":[],"scored":0}
```

**Suggested fix.** Всегда создавать INTERNAL-находку (она на платформе spec, которая активна при любом --target) или хотя бы писать причину в skipped: `${rule.id} threw: ...`.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — Строка 109 актуальна: в src/rules/engine.ts:106-113 catch добавляет INTERNAL-находку только при `if (applies)`. При этом правило вне --target всё равно выполняется ради score (комментарий в строке 96, строки 98-107). Выше по стеку исключение никто не обрабатывает, потому что runRules ловит его сам. В skipped попадает только 'not applicable to --target X', про исключение там ничего нет. Спека (docs/design/spec.md §4.2, строка ~1291) требует без оговорок: engine «catches exceptions thrown by a rule and turns them into an INTERNAL info finding», исключения для правил вне target там нет. test/engine.test.ts:29-31 проверяет INTERNAL только для активного target, так что намеренность подавления тестом не подтверждается. Одну часть описания стоит уточнить. «score считается без этого правила» верно, но это не зависит от target: при --target all правило тоже бросает исключение и тоже ничего не даёт в scored (INTERNAL в scored не пишется ни в одной ветке). Значит, score при claude и при all одинаков, а реальный дефект только в диагностике: при узком --target сбой правила ничем не виден. Severity low.

### F136 [low/bug] RangeError (Maximum call stack) при странице tools/list с ≥~125k элементов → падение линтера с exit 3

**Where.** `src/protocol/legacy.ts:53` (reviewer: security-lens)

**What.** src/protocol/legacy.ts:42 (не 53; строка в находке устарела) делает `items.push(...list.map(...))`, то же в src/protocol/modern.ts:105 (`items.push(...list.filter(isObj))`, не 166). Если на одной странице tools/list (или prompts/resources) примерно 200k элементов, spread превышает лимит аргументов/стека V8 и бросает RangeError. Внутри listAll он не перехватывается: try/catch стоит только вокруг client.request. Дальше исключение уходит через listEverything → buildHttp/buildStdio → buildSnapshot (там catch только закрывает клиента и пробрасывает исключение) → runCli. В итоге вместо отчёта/SPEC-находки печатается `fatal:` со stack trace и exit 3. Воспроизводится только на патологическом или злонамеренном сервере (ответ около 3 МБ). Линтер падает с понятным кодом, утечек и вреда хосту нет, поэтому это редкий край, а не medium.

**Evidence.** node: `a.push(...new Array(200000).fill(1))` → "Maximum call stack size exceeded". Репро на dist/protocol/legacy.js с фейковым клиентом, возвращающим 200k tools: `THROWS: RangeError Maximum call stack size exceeded`. Аналогично src/protocol/modern.ts:166 `items.push(...list.filter(isObj))`.

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f136.mjs вызывает listAll из dist/protocol/legacy.js с фейковым client.request, который возвращает {tools: Array(n).fill({name:'t'})}. Вывод:
100000 OK 100000
125000 OK 125000
200000 THROWS RangeError Maximum call stack size exceeded
```

**Suggested fix.** Заменить spread на цикл `for (const x of list) items.push(...)` или `items = items.concat(...)`, и одновременно ввести лимит общего числа элементов листинга (например 10 000 с записью в snap.limits.truncated), чтобы не раздувать правила.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Сначала прочитал код. src/protocol/legacy.ts:28-50: listAll ловит исключения только у client.request, а spread в push на строке 42 стоит вне try. В modern.ts:105 тот же паттерн. Затем посмотрел, кто вызывает listAll. В connect.ts:336-339 lister вызывается из listEverything без try. В buildSnapshot (около строки 531) catch закрывает клиента и делает `throw e`, а withDeadline тоже пробрасывает не-Stopped ошибки. В cli.ts:337-347 общий catch отдаёт `fatal: <stack>` и code 3. Только вызов в connect.ts:490 обёрнут в try и возвращает undefined. Ни в спеке, ни в тестах я не нашёл ничего, что делало бы такое поведение намеренным. Поэтому суть утверждения подтверждена, но указанные номера строк устарели: на самом деле это 42 и 105. Severity понижаю до low: сценарий требует аномальной страницы из сотен тысяч элементов, а результат — контролируемый выход с кодом 3, а не неверный отчёт и не утечка.
- *repro*: confirmed (conf 0.9) — Воспроизвёл на dist/protocol/legacy.js с фейковым клиентом. 50k и 125k элементов проходят, на 200k вылетает RangeError. По коду исключение никто не перехватывает на всём пути: listAll → listEverything → runCli. В cli.ts:346 оно превращается в fatal с exit 3. Аналогичный spread есть в modern.ts:105. Номера строк в находке устарели: 53→42, 166→105. Severity понизил до low. Сработать может только сервер, который намеренно отдаёт огромную страницу (около 2 МБ JSON, лимит FULL_READ_CAP 64 МБ это допускает). Утечки нет, ложного PASS нет, основной сценарий на реальных серверах не ломается. Предложенное исправление (цикл или concat плюс общий лимит числа элементов) корректно.

### F137 [low/security] OOM: rawPages удерживает до 100 страниц × 64 МБ, capSnapshot их не режет

**Where.** `src/protocol/modern.ts:164` (reviewer: security-lens)

**What.** ModernClient.listAll (src/protocol/modern.ts:95-113) хранит каждую страницу листинга целиком: `pages.push(r.result)` в строке 103, и та же ссылка остаётся в `tracer.exchanges[*].json`. Каждая страница читается с лимитом FULL_READ_CAP = 64 MiB (trace.ts:10), страниц до 100 на листинг, общего байтового бюджета нет. Страницы попадают в `snap.listMeta[*].rawPages` (connect.ts:115), а capSnapshot (limits.ts:37-65) их не режет. Если сервер в режиме era modern отдаёт страницы вида `{"tools":[],"nextCursor":"<новый>","pad":"<~60 МБ>"}`, CLI накапливает гигабайты и падает с OOM, не выдав отчёта. Дублирование в `modern.results` и `exchange.json` — это ссылки на тот же объект, а не копии. redactDeep копирует данные только при непустом redactor. Как исправить: ввести суммарный байтовый бюджет на листинг или на весь прогон и прекращать пагинацию с error. Вариант — хранить в rawPages только ключи, нужные правилам (без больших произвольных строк), или прогонять rawPages через capStrings.

**Evidence.** trace.ts:298 `FULL_READ_CAP = 64 * 1024 * 1024`; modern.ts:156 `maxPages = 100`, :164 `pages.push(r.result)`; connect.ts:115 `rawPages: r.pages`; limits.ts:704-731 не трогает listMeta; redact.ts:888 redactDeep копирует всё (`SERVER_DATA` включает 'rawPages').

**Repro (verifier).**

```
Не запускал: генерация многогигабайтных ответов не вписывается в ограничения задачи. Статическая цепочка: tracer.request(fullBody) → readBody(cap=64 MiB) → JSON.parse в ex.json → modern.ts:103 pages.push → connect.ts:115 rawPages → capSnapshot не обходит listMeta → spec.ts:471 обходит все rawPages.
```

**Suggested fix.** Ввести общий байтовый бюджет на листинг (например 16 МБ на метод, считая длину тела каждой страницы) и прекращать пагинацию с error='listing exceeded N bytes'; снизить FULL_READ_CAP до разумного (8–16 МБ) и/или хранить в rawPages только нужные правилам ключи (tools/nextCursor/_meta); не дублировать результат в modern.results.

**Verifier votes.**

- *reader*: confirmed (conf 0.75) — По существу утверждение подтверждается, но номера строк в evidence устарели. В src/protocol/modern.ts всего 114 строк, строки 164 нет. На деле `pages.push(r.result)` стоит в строке 103, `maxPages = 100` в строке 95, `results.push` в строке 87. FULL_READ_CAP определён в trace.ts:10, а не :298. В limits.ts 80 строк, в redact.ts 179, так что ссылки limits.ts:704-731 и redact.ts:888 неверны.

Механизм проверил по коду:
- ModernClient.request вызывает tracer.request с `fullBody: true`. readBody читает тело до FULL_READ_CAP = 64 MiB, ограничение только по времени запроса (`--timeout`, по умолчанию 30 с; для локального или быстрого сервера 64 МБ укладываются легко). finishBody делает JSON.parse и кладёт объект в `ex.json`, exchange остаётся в `tracer.exchanges`.
- listAll складывает каждый result в `pages`; общего байтового бюджета нет, есть только лимит в 100 страниц.
- connect.ts:115 сохраняет их в `snap.listMeta[*].rawPages`, а connect.ts:336 вызывает modern.listAll для всех листингов, когда SDK-подключение не удалось (era modern).
- capSnapshot (limits.ts:37-65) обходит только tools/prompts/resources/resourceTemplates/serverInfo/instructions/resourceReads; listMeta.rawPages и произвольные ключи страницы (например `pad`) не обрезаются.
- Правило в spec.ts:471 дополнительно обходит все rawPages.
- Ни в тестах, ни в spec.md нет намерения ограничивать суммарный объём. В spec.md описан только лимит в 100 страниц (SPEC-020) и чтение тела в пределах timeout.

Уточнения к описанию автора:
- Дублирование в `modern.results`, `exchange.json` и `pages` — это ссылки на один и тот же объект, а не копии; объём памяти от этого не множится.
- redactDeep копирует данные только при непустом redactor (заданы секреты или заголовки авторизации), так что «×2» бывает не всегда.

Даже без копий 100 страниц × ~64 МБ на один листинг (до 4 листингов) превышают стандартный heap Node (~2–4 ГБ). Враждебный или сломанный сервер может уронить CLI с OOM, и отчёта не будет.

Severity понижаю до low. Нужен целенаправленно враждебный сервер с era modern. Ни утечки секретов, ни неверного результата нет, это отказ в обслуживании локального линтера. Тяжёлый repro (сервер с 64-МБ страницами) не запускал из-за ограничений задачи; вывод основан на чтении кода.
- *repro*: confirmed (conf 0.85) — Код совпадает с утверждением, хотя номера строк в находке устарели: файл сейчас 114 строк, push стоит на строке 103, maxPages=100 — на строке 95. FULL_READ_CAP=64 МБ ограничивает только одно тело ответа. Во время листинга по умолчанию никакой суммарный лимит не действует: --max-duration по умолчанию не ограничен, а timeout 30 с дан на каждый запрос. Воспроизвёл на локальном HTTP-сервере 127.0.0.1, вызывая dist/protocol/modern.js. Всего 10 страниц по 60 МБ подняли heapUsed с 7 до 668 МБ, а RSS до 1421 МБ, и всё это удерживается. При 100 страницах это ~6 ГБ, что гарантированно даёт OOM. Полные 100 страниц не запускал, чтобы не уронить VM. Утверждение про дублирование в modern.results неточно: там ссылка, а не копия. Влияние — DoS самого CLI со стороны проверяемого враждебного сервера. Это редкий край, поэтому low.

### F138 [low/security] Legacy (SDK) путь читает тела ответов без ограничения размера — лимиты линтера не действуют

**Where.** `src/protocol/trace.ts:486` (reviewer: security-lens)

**What.** Номер строки устарел: в src/protocol/trace.ts 264 строки, sdkFetch находится в строках 198-219. Факт подтверждается: sdkFetch возвращает SDK исходный Response, а READ_CAP (256 КБ) применяется только к res.clone(), который нужен для трассировки. SDK затем читает тело целиком: StreamableHTTPClientTransport вызывает `await response.json()` (streamableHttp.js:409), у SSE-парсера нет лимита. Ни здесь, ни выше по стеку (connect.ts:202/242 передаёт tracer.fetch как есть) размер тела для путей legacy/dual/sse-legacy не ограничен. У пути ModernClient/request есть потолок FULL_READ_CAP 64 МБ с ошибкой BodyTruncated, так что пути ведут себя по-разному. Утверждение автора о том, что TEXT_CAP/HTML_CAP «защищают только ModernClient», неточно. capSnapshot применяется к snapshot в обоих путях, но эти лимиты нужны против дорогих regex, а не для ограничения памяти (так сказано в README «Input caps» и в комментарии limits.ts). Последствие: враждебный или сломанный сервер может отдать ответ на сотни МБ и исчерпать память самого CLI. Это DoS только локального процесса линтера, который пользователь сам запустил против выбранной цели. Утечки секретов и влияния на корректность обычных отчётов нет.

**Evidence.** trace.ts:494-502: `const res = await fetch(url, …); … const clone = res.clone(); pending.push(readBody(clone, BODY_TIMEOUT_MS, READ_CAP, rpcId)); return res;` — кап применяется к клону, не к ответу для SDK. node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js:409 `const data = await response.json();`. Для stdio SDK имеет лимит 10 МБ (shared/stdio.js STDIO_DEFAULT_MAX_BUFFER_SIZE), для HTTP — нет.

**Repro (verifier).**

```
Repro не запускал. Код: src/protocol/trace.ts:209-214 — `const clone = res.clone(); ... readBody(clone, BODY_TIMEOUT_MS, READ_CAP, rpcId) ...; return res;` (лимит применяется только к клону). node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js:409 — `const data = await response.json();`. Сценарий: legacy-сервер отвечает на tools/list JSON-ом на 500 МБ с Content-Type application/json, и CLI буферизует и парсит всё тело.
```

**Suggested fix.** В sdkFetch оборачивать res.body в TransformStream, который считает байты и при превышении бюджета (например 32 МБ) вызывает controller.error(new Error('BodyTooLarge')) — тогда SDK получит ошибку запроса, а линтер — SPEC-находку; дополнительно проверять Content-Length заранее. Отразить реальные лимиты в README/SECURITY.md.

**Verifier votes.**

- *reader*: confirmed (conf 0.7) — Проверил код: trace.ts:198-219 (sdkFetch) и 229-246 (request с FULL_READ_CAP), connect.ts:202 и 242 (tracer.fetch передаётся в StreamableHTTPClientTransport и SSEClientTransport без обёртки), limits.ts (TEXT_CAP/HTML_CAP обрезают строки уже распарсенного snapshot и защищают от стоимости regex), SDK streamableHttp.js:409 (`response.json()`), shared/stdio.js (лимит 10 МБ есть только у stdio). В spec.md и README нет обещания ограничивать память для SDK-пути. В spec.md:1132 лимиты 256 КБ/64 МБ описаны только для 2026-07-28 JSON-RPC и для проб. Тестов в test/, которые фиксировали бы такое поведение как намеренное, нет: grep по FULL_READ_CAP/READ_CAP/sdkFetch пуст. Значит, расхождение между путями реальное, но это не ошибка корректности. Это проблема устойчивости: падение по памяти локального CLI при враждебном сервере. Поэтому severity снижаю до low. Line 486 устарела. Repro не запускал: дефект следует прямо из кода, клон и оригинальный Response независимы.
- *repro*: confirmed (conf 0.85) — По коду: в sdkFetch (dist/protocol/trace.js) после fetch вызывается только `pending.push(readBody(clone, BODY_TIMEOUT_MS, READ_CAP, rpcId))`, и затем возвращается исходный `res` без обёртки. Проверки Content-Length и подсчёта байтов в потоке нет. В connect.ts tracer.fetch передаётся в StreamableHTTPClientTransport и SSEClientTransport. SDK вызывает response.json() без лимита. Репродукция подтвердила проблему: локальный HTTP-сервер вернул 80 МБ JSON, и SDK получил его полностью. Номер строки в находке неверный, но суть верна. Severity medium: это DoS линтера со стороны проверяемого сервера, утечки секретов нет.

### F139 [low/security] Число resources/read для ui:// не ограничено; каждое чтение до 64 МБ удерживается до capSnapshot

**Where.** `src/connect.ts:125` (reviewer: security-lens)

**What.** readUiResources (src/connect.ts:125-134) по одному читает через resources/read каждый уникальный ui:// URI из tools и resources. Ни числа URI, ни общего объёма прочитанного он не ограничивает. Тело ответа ограничено только в modern-ридере: FULL_READ_CAP = 64 МБ (src/protocol/trace.ts:10). legacy-ридер через SDK ограничен лишь per-request timeout. HTML_CAP (2 МБ) применяется позже, в capSnapshot. Поэтому враждебный или сломанный сервер может объявить много ui:// URI с большими телами и раздуть память процесса или сильно затянуть проверку. Без --max-duration общего бюджета времени нет. Чтение всех UI URI задумано спекой (docs/design/spec.md:1177: «resources/read every UI URI»), так что дефект только в отсутствии страховочного лимита. Это редкий край: проверяемый сервер, как правило, принадлежит самому пользователю, а неограниченный tools/list даёт тот же класс DoS. Отсюда severity low, а не medium.

**Evidence.** connect.ts:126-133: `const uris = new Set<string>(); for (const t of snap.tools) …uris.add(u); for (const r of snap.resources) …; for (const uri of uris) { const r = await read(uri); snap.resourceReads[uri] = {...} }` — нет slice/лимита. limits.ts:715-728 режет c.text/c.blob уже после.

**Repro (verifier).**

```
Статическая проверка кода, без запуска. src/connect.ts:125-134: `for (const uri of uris) { const started = now(); const r = await read(uri); snap.resourceReads[uri] = { ...r, durationMs: now() - started }; }`, лимита нет. src/protocol/trace.ts:10: `FULL_READ_CAP = 64 * 1024 * 1024`. src/limits.ts:9: `HTML_CAP = 2 * 1024 * 1024`, применяется только в capSnapshot (limits.ts:37-60). src/probe/active.ts:11: `MAX_TOOLS = 50`, но это только для активных вызовов. docs/design/spec.md:1177: «Then `resources/read` every UI URI».
```

**Suggested fix.** Ограничить число читаемых UI-ресурсов (например 25, остальное — в snap.limits.truncated с заметкой в отчёте) и общий байтовый бюджет; резать text/blob до HTML_CAP сразу в reader'е, а не в capSnapshot.

**Verifier votes.**

- *reader*: confirmed (conf 0.65) — Строка 125 актуальна: там начинается async function readUiResources. Код строит Set из ui:// URI по snap.tools (uiUriOf) и snap.resources и в цикле for…of делает await read(uri) для каждого без slice или счётчика. Результат целиком ложится в snap.resourceReads. Ридеры: modernReader идёт через tracer с FULL_READ_CAP 64 МБ, legacyReader — через client.request без ограничения размера, только с timeoutMs. В src/limits.ts capSnapshot режет c.text и c.blob до HTML_CAP уже после всех чтений. Похожий лимит в проекте есть только в probe/active.ts (MAX_TOOLS = 50 для tools/call), для UI-ресурсов его нет. Тестов, которые закрепляли бы неограниченное поведение как намеренное, я не нашёл. Спека требует читать все UI URI, но лимит на размер или количество в качестве страховки ей не противоречит. Фактическая часть утверждения подтверждается. Severity завышена: ломается не основной сценарий, а только случай с враждебным или аномальным сервером, против которого инструмент и так уязвим через неограниченные листинги. Частично смягчает --max-duration.
- *repro*: confirmed (conf 0.85) — Проверил код. В readUiResources есть `for (const uri of uris) { await read(uri); snap.resourceReads[uri] = {...} }`, и никакого slice или лимита там нет. legacyReader и modernReader не режут ответ (у modern есть только FULL_READ_CAP = 64 МБ на ответ). Обрезка до HTML_CAP происходит лишь в capSnapshot. Воспроизвёл через buildSnapshot из dist/connect.js против локального stdio-сервера на SDK, сеть не нужна. Сервер отдавал N ресурсов ui:// по SZ байт. Результат: прочитаны все N, пиковая память растёт линейно (40 × 4 МБ дают около 341 МБ), а обрезка срабатывает уже постфактум (truncated=40). Сама находка подтверждена. Severity снижаю с medium до low: вредит только намеренно враждебный сервер (DoS самого линтера). Результат проверки от этого не становится неверным, секреты не утекают, а частично помогает --max-duration. Сценарий 1000 × 64 МБ = OOM я не прогонял, это экстраполяция линейного роста.

### F141 [low/security] Непомерный рост nonJson/buf для stdio: все не-JSON строки stdout накапливаются без лимита, Buffer.concat квадратичен

**Where.** `src/connect.ts:437` (reviewer: security-lens)

**What.** Надёжность, не безопасность. В stdio-режиме каждая непустая не-JSON строка stdout накапливается в nonJson без лимита (src/connect.ts:444). Массив целиком попадает в snapshot, redactDeep копирует его и скрабит каждую строку, capSnapshot его не обрезает, а SRV-018 использует только счётчик и первые 3 строки. Параллельно RecordingTransport.transportErrors (src/protocol/recording.ts:25) копит по Error на каждую такую строку и нигде не читается. Получается примерно 20-кратное усиление: 30 МБ stdout-логов дают около 830 МБ RSS, а 100 МБ (1 млн строк) — падение линтера с "JavaScript heap out of memory". Сценарий с одной гигантской строкой без \n ограничен 10 МБ ReadBuffer SDK, после чего транспорт закрывается; квадратичный concat там несущественен.

**Evidence.** connect.ts:437-445: `let buf = Buffer.alloc(0); proc?.stdout?.on('data', (c) => { buf = Buffer.concat([buf, c]); … if (line.trim() && !isJsonLine(line)) nonJson.push(line); })`. rules/server.ts:454-457 использует lines.slice(0,3) и lines.length. capSnapshot (limits.ts) nonJsonStdout не ограничивает.

**Repro (verifier).**

```
Скрипты: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f141/server.mjs (сначала пишет N строк 'log: xxx…' по 100 байт в stdout, затем отвечает на initialize и tools/list) и run.mjs (import { buildSnapshot } from dist/connect.js; target {kind:'stdio', command: node, args:[server.mjs, N]}; печатает nonJsonStdout.length, прирост heap и peak RSS). Запуск: N=<n> node run.mjs. Результаты: N=0 даёт RSS 89 МБ; N=100000 — 379 МБ; N=300000 — 830 МБ; N=1000000 — FATAL ERROR: JavaScript heap out of memory. Важно: N передаётся через argv, потому что getDefaultEnvironment не пробрасывает произвольные env-переменные в дочерний процесс.
```

**Suggested fix.** Хранить максимум N строк (например 50, каждая ≤ 1 КБ) плюс счётчик `dropped`; при buf.length > 1 МБ без перевода строки — сбрасывать буфер и считать как одну «длинную не-JSON строку»; isJsonLine вызывать только для строк, начинающихся не с '{'/'[' (быстрая проверка вместо JSON.parse).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.55) — Основное утверждение верно: connect.ts:437-445 складывает каждую не-JSON строку в nonJson без лимита. capSnapshot (src/limits.ts:37) nonJsonStdout не трогает, а SRV-018 (rules/server.ts:454-457) берёт только length и первые 3 строки. SDK на не-JSON строках не обрывается: deserializeMessage бросает исключение, processReadBuffer вызывает onerror и продолжает, так что массив растёт всё время работы сервера (до --timeout/--max-duration). Часть про длинную строку без \n в основном опровергается: SDK ReadBuffer (sdk shared/stdio.js:10-14) бросает исключение при >10 МБ, транспорт закрывается и процесс убивается, поэтому наш buf ограничен примерно 10 МБ. Квадратичный Buffer.concat до 10 МБ есть и в самом SDK, это не катастрофа. Квалификация как security завышена: stdio-сервер — локальный процесс, который пользователь сам запускает с полным исполнением кода, поэтому это не граница доверия, а надёжность (возможен OOM линтера на сервере, который шумно логирует в stdout).
- *ARBITER (round 2)*: confirmed (conf 0.9) — [partially-confirmed] Арбитраж F141 (src/connect.ts:428-446).

ЧТО ВЕРНО (подтверждено кодом и репро):
1) connectStdio через tap() складывает каждую непустую не-JSON строку stdout в nonJson без лимита (connect.ts:444). Массив целиком уходит в snap.transport.stdio.nonJsonStdout (connect.ts:510, а также 656 для пути по дедлайну). Затем redactDeep копирует и скрабит каждую строку (connect.ts:541), а capSnapshot (limits.ts:37-62) nonJsonStdout не обрезает. Потребитель только SRV-018 (rules/server.ts:454-457), и он берёт lines.length и lines.slice(0,3). Хранить всё остальное незачем.
2) SDK от не-JSON строк НЕ обрывается. ReadBuffer.readMessage после каждой строки делает subarray, deserializeMessage бросает исключение, processReadBuffer ловит его, вызывает onerror и продолжает. Значит, накопление идёт всё время жизни основного соединения, до --timeout/--max-duration. Тут прав верификатор.
3) Репро против dist/connect.js (buildSnapshot, фейковый stdio-сервер, который пишет N строк по 100 байт, а потом нормально отвечает на initialize и tools/list; скрипты лежат в /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f141/):
   - N=0: 0 строк, peak RSS 89 МБ;
   - N=100000 (10 МБ stdout): 100000 строк, прирост heap +231 МБ, peak RSS 379 МБ;
   - N=300000 (30 МБ): прирост heap +680 МБ, peak RSS 830 МБ;
   - N=1000000 (100 МБ): процесс линтера падает: "FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory" (лимит heap около 2.2 ГБ).
   Усиление примерно 20x к объёму stdout. Вероятный дополнительный источник, которого нет ни в находке, ни у верификатора: RecordingTransport (src/protocol/recording.ts:14,25) кладёт каждую транспортную ошибку в transportErrors, а это по объекту Error со стеком на каждую не-JSON строку. Массив нигде не читается и не ограничен. Сюда же добавляются копия от redactDeep и скраб каждой строки. Вклад transportErrors в рост памяти я не мерил отдельно, это вывод из кода.

ЧТО НЕВЕРНО:
4) Сценарий с «гигантской строкой без \n» в основном опровергнут. Наш обработчик data в GroupStdioTransport.start (connect.ts:630) и в SDK (client/stdio.js:90-97) при превышении 10 МБ ReadBuffer (shared/stdio.js:10-14) вызывает onerror и close(). Процесс завершается, поток stdout кончается, поэтому наш buf тоже ограничен примерно 10 МБ плюс хвост в полёте. Квадратичный Buffer.concat до 10 МБ есть и в самом SDK. Это не самостоятельный дефект, а мелкая неэффективность. Тут верификатор прав, а находка преувеличивает.
5) Классификация как security завышена. stdio-сервер — локальная команда, которую пользователь сам запускает с полным исполнением кода. Границы доверия здесь нет: такой сервер может исчерпать ресурсы машины и без линтера. Это дефект надёжности: линтер падает с OOM вместо того, чтобы выдать находку SRV-018, а ведь именно такой «шумный» сервер это правило и должно ловить.

ПО СТОРОНАМ: находка права по сути (неограниченный nonJson, лишнее хранение, отсутствие cap), но ошибается в части про длинную строку и в категории (security). Верификатор прав в обоих возражениях. Однако он недооценил практический эффект («раздувает память») и не учёл транспортных ошибок. Репро показывает, что уже около 100 МБ stdout-логов (порядка миллиона строк за прогон, реально для сервера с debug-логированием в stdout в цикле) роняют процесс. Порог OOM снижается примерно в 20 раз за счёт накладных расходов. Severity оставляю low: локальный самозапускаемый процесс, нужен патологически шумный сервер, утечки данных нет. Ближе к границе с medium, потому что исход — падение инструмента, а не деградация.

C004 (Windows npx/.cmd) к F141 не относится. На win32 GroupStdioTransport.start делегирует super.start() (connect.ts:620), и там тот же ReadBuffer SDK, так что выводы по платформе не меняются.

ИСПРАВЛЕНИЕ: хранить первые N (около 3-50) строк, каждую обрезать до 1 КБ, плюс счётчик count. SRV-018 должен брать count. В RecordingTransport ограничить transportErrors (или убрать, раз он не читается). Опционально: если buf без \n больше 1 МБ, сбрасывать его и считать как одну длинную не-JSON строку.

### F144 [low/bug] --tool-args: поиск аргументов по имени инструмента через прототип (`constructor`, `__proto__`, `toString`)

**Where.** `src/probe/active.ts:83` (reviewer: security-lens)

**What.** Если передан --tool-args, то для read-only инструмента с именем из Object.prototype (`constructor`, `toString`, `hasOwnProperty`, `__proto__` и т.п.) выражение `ctx.toolArgs?.[name]` в active.ts:83 возвращает унаследованное свойство. Вызов помечается как kind 'valid' без настоящих аргументов: поле arguments пропадает при сериализации, а для `__proto__` уходит пустой объект. Синтез по inputSchema при этом пропускается, и это искажает RT-правила, которые опираются на 'valid'. Исправление: брать аргументы через `Object.hasOwn(ctx.toolArgs, name)`.

**Evidence.** active.ts:83-85: `const provided = ctx.toolArgs?.[name]; const args = provided !== undefined ? provided : synthesizeArgs(t.inputSchema); calls.push(await call(ctx, name, provided !== undefined ? 'valid' : 'synthetic', args));` — toolArgs создаётся JSON.parse (readToolArgs, cli.ts:176) как обычный объект с прототипом Object.

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/f144.mjs вызывает runActive из dist/probe/active.js с заглушкой modern, toolArgs={"get_x":{"q":"a"}} и пятью readOnly-инструментами (required:['q']). Вывод:
constructor valid function
toString valid function
__proto__ valid object
hasOwnProperty valid function
get_x valid object
Отправленные params: {"name":"constructor"} (поля arguments нет, синтез {q:'mcp-review-check'} пропущен).
```

**Suggested fix.** Использовать `Object.hasOwn(ctx.toolArgs, name) ? ctx.toolArgs[name] : undefined` либо парсить --tool-args в Map/Object.create(null).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.9) — Строка актуальна: в src/probe/active.ts:83 стоит `const provided = ctx.toolArgs?.[name];`, проверки на собственное свойство нет. Объект toolArgs получается из JSON.parse в readToolArgs (src/cli.ts:174-177), а cli.ts:280 проверяет только, что это объект и не массив, так что прототип у него обычный Object.prototype. Выше и ниже по стеку случай нигде не обрабатывается: connect.ts:363/504 передаёт toolArgs как есть. Тестов в test/, которые закрепляли бы такое поведение как намеренное, нет. По spec.md:979/1136 аргументы берутся только из `{toolName: args}`, а иначе синтезируются, поэтому найденное поведение спецификации противоречит. Ограничение: проблема проявляется только с --tool-args (без флага `?.` даёт undefined) и только для инструмента с readOnlyHint=true, у которого имя совпадает с членом Object.prototype. Имя инструмента задаёт сервер. В таком случае вызов получает kind 'valid', в params.arguments уходит функция, которую JSON.stringify опускает (поле arguments пропадает), или для `__proto__` сам Object.prototype. Синтез аргументов пропускается, и ошибку сервера на по сути пустом вызове RT-правила засчитывают как ошибку на «валидном» вызове. Влияние небольшое: нужен узкий набор имён, флаг --tool-args и readOnly-аннотация.

### F148 [low/docs-mismatch] README одновременно утверждает «не опубликовано в npm» и даёт рецепты через npx mcp-review-check@0.1

**Where.** `README.md:66` (reviewer: docs-tests-ci)

**What.** Номер строки верный: README.md:66 «This version is not published to npm yet. From a checkout: npm install && npm run build, then node dist/cli.js <url> or npm link.» Пометка стоит сразу после первого примера с npx в разделе Usage. Это намеренное временное состояние до релиза: docs/design/spec.md:1351 требует «No publishing in this phase. Run locally with node dist/cli.js or npm link». Поэтому для основного сценария пользователю дан явный обходной путь, и сам основной сценарий не ломается. Реальная проблема уже, чем заявлено. CI-рецепты (README.md:206, 222), Docker Compose (README.md:241) и совет по закреплению версии (README.md:305) используют `npx -y mcp-review-check@0.1`, но ни оговорки, ни варианта с node dist/cli.js у них нет: если скопировать их до публикации, они упадут. К тому же CHANGELOG.md объявляет [0.1.0] - 2026-10-25 «First public release», а это противоречит фразе «not published». Это несогласованность документации без влияния на код, поэтому severity low, а не medium. Тест test/docs.test.ts намеренно требует npx в строках 1–5 README, так что npx-вид рецептов задуман как целевой. Исправление: пометить npx-рецепты как работающие после релиза или привести в CI/Compose запасной вариант, а также согласовать CHANGELOG и README.

**Evidence.** README.md:5 «Run `npx mcp-review-check https://mcp.example.com/mcp` (no install, no account)»; README.md:66 «This version is not published to npm yet.»; README.md:196 «- run: npx -y mcp-review-check@0.1 --target claude --stdio -- node dist/server.js»; README.md:243 «command: npx -y mcp-review-check@0.1 http://mcp:8080/mcp --target claude». git tag v0.1.0 существует (git log 2026-10-25), статус публикации в npm офлайн не проверить.

**Repro (verifier).**

```
grep -n "npx -y mcp-review-check@0.1\|not published" README.md -> 66: This version is not published to npm yet...; 206/222/241: npx -y mcp-review-check@0.1 ...; grep -n "No publishing" docs/design/spec.md -> 1351; CHANGELOG.md: "## [0.1.0] - 2026-10-25 / First public release."
```

**Suggested fix.** После публикации удалить строку 66; до публикации — явно пометить npx-рецепты «after the npm release» и дать вариант `node dist/cli.js`/`npm link` в CI-рецептах. Добавить в test/docs.test.ts проверку, что README не содержит одновременно «not published» и `npx -y mcp-review-check@`.

**Verifier votes.**

- *reader*: confirmed (conf 0.6) — Я прочитал F148.json, README.md (строки 1–68 и 195–245, а также найденные grep строки 5, 34–63, 305), docs/design/spec.md:1351, test/docs.test.ts и CHANGELOG.md. Противоречие есть: в README.md:66 сказано «not published», а в строках 206/222/241/305 даны рецепты с `npx -y mcp-review-check@0.1` без каких-либо оговорок. CHANGELOG при этом называет 0.1.0 «First public release», что только добавляет путаницы. Ниже по стеку это ничем не исправляется, потому что это документация. Утверждение автора о том, что пользователь не может понять, какой путь верный, преувеличено. Пометка на строке 66 однозначно говорит, что npx пока не работает, и даёт рабочую замену. Состояние «без публикации» намеренно, это подтверждает spec.md:1351. Тест docs.test.ts намеренно требует npx в верхних строках README. Поэтому находку я подтверждаю только как косметическую несогласованность документации и понижаю severity до low. Сеть и npm я не проверял: факт публикации офлайн не подтвердить.
- *repro*: confirmed (conf 0.85) — Сравнил README.md с grep-выдачей: на строке 66 написано «not published to npm yet», а на строках 5, 34–63, 206, 222, 241 и 305 даны рецепты через npx, в том числе `npx -y mcp-review-check@0.1`. Противоречие в документе реальное. Чтобы понять, какая из двух версий верна, выполнил одну пассивную read-only проверку `npm view`, запущенную из scratchpad. Она показала, что пакет опубликован (0.1.0, создан 2026-10-25), а repository и homepage совпадают с package.json проекта. Получается, что npx-рецепты работают, а устарела строка 66. Утверждение автора о противоречии верно, но его вывод «либо все npx-рецепты сейчас не работают» на деле не подтвердился. Вред сводится к вводящей в заблуждение фразе, в том числе на странице пакета в npm, поэтому severity понижаю с medium до low.

### F149 [low/docs-mismatch] «What the tool sends» для --active не упоминает три дополнительных соединения с поддельным clientInfo.name и лимит 50 инструментов

**Where.** `SECURITY.md:30` (reviewer: docs-tests-ci)

**What.** SECURITY.md:33 (не 30), абзац «With --active», говорит только о вызовах read-only инструментов (не больше 3 вызовов на инструмент). Про два других действия режима там ничего нет. Во-первых, runActive (src/probe/active.ts:95-102) открывает до трёх свежих соединений (connect.ts:364 для streamable-http, :505 для stdio) с clientInfo.name = 'mcp-review-check', 'claude-ai' и 'Anthropic' и в каждом вызывает tools/list для RT-012. Во-вторых, вызываются только первые 50 подходящих инструментов (active.ts:80, MAX_TOOLS=50). README тоже об этом молчит (строки 10, 83, 261), хотя CONTRIBUTING.md:28 требует перечислять каждый проб, который отправляет трафик, и в README, и в SECURITY.md, а SECURITY.md «Scope» сам относит «a request the documentation does not list» к security-scope. Лимит 50 описан только во внутреннем docs/design/spec.md:977. В отчёте отсечение инструментов не отмечается.

**Evidence.** src/probe/active.ts:11 `const MAX_TOOLS = 50;`, :80 `ctx.snap.tools.filter(isSafeToCall).slice(0, MAX_TOOLS)`, :97-101 `for (const n of ['mcp-review-check', 'claude-ai', 'Anthropic']) { const names = await ctx.listWithClientName(n); …}`; src/connect.ts:364,505 `listWithClientName: async (name) => (await fresh({ clientName: name }))`. `grep -n "clientInfo\|RT-012\|50 tools\|first 50" README.md SECURITY.md` → ничего.

**Repro (verifier).**

```
grep -n "clientInfo\|MAX_TOOLS\|first 50\|50 tools" README.md SECURITY.md → пусто; grep -rn "MAX_TOOLS\|50 tools" src docs/design/spec.md → src/probe/active.ts:11,80; docs/design/spec.md:977 "At most 3 calls per tool and 50 tools". SECURITY.md:33: "With --active, the tool calls tools annotated readOnlyHint: true (at most 3 calls per tool)…" — про свежие соединения с clientInfo.name claude-ai/Anthropic ничего нет.
```

**Suggested fix.** Дописать в README «What the tool sends» и SECURITY.md «With --active»: «…and up to three fresh connections whose clientInfo.name is mcp-review-check, claude-ai and Anthropic (RT-012); at most the first 50 read-only tools are called». В отчёте (limits/notes) сообщать, если инструменты были отсечены лимитом 50.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Проверил код: active.ts:11 `MAX_TOOLS = 50`, :80 `.slice(0, MAX_TOOLS)`, :97 цикл по ['mcp-review-check','claude-ai','Anthropic'] через ctx.listWithClientName. Эта функция в connect.ts:364/505 открывает новое соединение fresh({clientName}). Grep по clientInfo, MAX_TOOLS и «50» в README.md и SECURITY.md ничего не нашёл. Лимит 50 есть только в docs/design/spec.md:977, это документ для разработчиков, а не для пользователя. Утверждение по сути верно, но номер строки устарел: абзац о --active стоит на строке 33. Severity снижаю до low. Дополнительные соединения делают только initialize и tools/list, состояние сервера они не меняют, секреты не утекают, и включаются они только вместе с явно запрошенным --active. Это неполнота документации о трафике и о скрытом лимите охвата RT-проверок, а не дефект, который ломает основной сценарий.
- *repro*: confirmed (conf 0.85) — Проверил код. В active.ts:97 есть цикл по ['mcp-review-check','claude-ai','Anthropic'] с вызовом ctx.listWithClientName. В connect.ts:364 и :505 этот метод открывает новое соединение (fresh) с clientName. В active.ts:80 стоит slice(0, MAX_TOOLS=50). grep по SECURITY.md на clientInfo, claude-ai, Anthropic и 50 ничего не находит. В строке 33 упомянуты только вызовы readOnly-инструментов («at most 3 calls per tool»), про fresh-соединения не сказано. Расхождение с правилом CONTRIBUTING.md:28 реальное. Номер строки в находке неточный (30 вместо 33). На severity это не влияет. Severity понижаю: это неполнота документации о безвредных list-запросах за opt-in-флагом. Утечки или изменения состояния нет.

### F152 [low/docs-mismatch] Число правил «144» захардкожено в README и spec.md и не синхронизируется генератором

**Where.** `README.md:7` (reviewer: docs-tests-ci)

**What.** README.md:7 (и docs/design/spec.md:8) содержат число правил 144, которое не генерируется scripts/rules-table.mjs и не проверяется test/docs.test.ts. Сейчас совпадает с каталогом (144 правила, 31 MAN), но добавление правила оставит README неверным без падения CI. Риск дрейфа, а не текущая ошибка.

**Evidence.** node -e "import('…/dist/rules/index.js').then(m=>console.log(m.RULES.length, m.MANUAL_ITEMS.length))" → `144 31`. scripts/rules-table.mjs:20-22 заменяет только RULES-блок, CATALOG_DATE и дату в `mcp-review-check \S+ · rules `; test/docs.test.ts не ищет «144».

**Repro (verifier).**

```
node -e "import('./dist/rules/index.js').then(m=>console.log(m.RULES.length, m.MANUAL_ITEMS?.length))" -> `144 31`; grep -rn "144\|automated rules" test -> нет совпадений; rules-table.mjs:16-19 — три .replace без счётчика правил.
```

**Suggested fix.** Ввести маркер `<!-- RULE_COUNT -->144<!-- /RULE_COUNT -->` (и `MAN_COUNT`) в README, обновлять его в rules-table.mjs из `RULES.length`, и добавить assert в docs.test.ts: число в README равно RULES.length.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — README.md:7 действительно содержит захардкоженное «144 automated rules», docs/design/spec.md:8 — «144 automated rules … 31 manual checklist items». scripts/rules-table.mjs --write заменяет только блок RULES:START/END, спаны <!-- CATALOG_DATE --> и дату в `mcp-review-check \S+ · rules <date>`; число правил не трогает (только печатает RULES.length в stderr). test/docs.test.ts проверяет первые 5 строк README (purpose/npx), заголовок примера отчёта с CATALOG_DATE, разделы и опции --help, но не число правил; grep по test/ на «144|automated rules» пусто (единственный RULES.length — в report.test.ts для SARIF). Сейчас значения совпадают (144/31), так что это только риск дрейфа документации, а не текущее несоответствие. spec.md явно помечен как design document, «may differ from the implementation», поэтому часть про spec.md менее значима; основное — README.

### F153 [low/docs-mismatch] CHANGELOG в формате Keep a Changelog без link-определений; раздел Changed в первом релизе описывает изменения относительно неопубликованного baseline

**Where.** `CHANGELOG.md:9` (reviewer: docs-tests-ci)

**What.** Заголовки `## [Unreleased]` и `## [0.1.0] - 2026-10-25` — reference-style ссылки, но в файле нет ни одной строки `[0.1.0]: https://…` → на GitHub рендерятся как литеральные скобки. Кроме того, для «First public release» есть 30+ пунктов в `### Changed`/«Severity raised/lowered», которые сравнивают с внутренним baseline («main d6100a9», ср. test/compat.test.ts:1), не существовавшим для пользователей — для читателя это шум: нечего было «менять».

**Evidence.** `grep -n '^\[' CHANGELOG.md` → пусто. CHANGELOG.md:9 `## [0.1.0] - 2026-10-25`, :80 `### Changed` (≈35 строк). test/compat.test.ts:1 «Compatibility sensors against the baseline (main d6100a9, mcp-review-check 0.1.0)».

**Repro (verifier).**

```
$ grep -n '^\[' CHANGELOG.md  -> (пусто)
$ sed -n 7,11p CHANGELOG.md -> '## [Unreleased]' / '## [0.1.0] - 2026-10-25' / 'First public release.'
$ sed -n 80p CHANGELOG.md -> '### Changed'
$ head -1 test/compat.test.ts -> '// Compatibility sensors against the baseline (main d6100a9, mcp-review-check 0.1.0)...'
```

**Suggested fix.** Добавить в конец `[Unreleased]: https://github.com/alisaosipova/mcp-review-check/compare/v0.1.0...HEAD` и `[0.1.0]: https://github.com/alisaosipova/mcp-review-check/releases/tag/v0.1.0`. Для 0.1.0 свести Changed/Severity-* в краткое Added (что умеет релиз); детальную историю относительно pre-release baseline перенести в docs/design или удалить.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — Проверено по CHANGELOG.md (114 строк). Строка 9 актуальна: `## [0.1.0] - 2026-10-25`, строка 7: `## [Unreleased]`. `grep -n '^\[' CHANGELOG.md` ничего не находит, то есть link-определений нет. Keep a Changelog 1.1.0, на который ссылается строка 3, ставит такие определения в конец файла, поэтому заголовки на GitHub выводятся с литеральными скобками. Ни README, ни CONTRIBUTING.md (строки 60 и 74 описывают только перенос записей из Unreleased), ни docs/design/spec.md не объявляют это намеренным, тестов на формат CHANGELOG нет. Вторая часть тоже подтверждается. Под заголовком «First public release» идут `### Changed` (строка 80, около 35 пунктов) и подразделы Severity raised/lowered. Они сравнивают с прежним поведением («Previously a spec-only error … failed `--target claude`», «it was left running»), а это внутренний baseline: в test/compat.test.ts:1 написано «baseline (main d6100a9, mcp-review-check 0.1.0)». Получается, что baseline и релиз имеют один номер 0.1.0, и читателю релиза сравнивать не с чем. Эта часть относится к стилю и функциональных последствий не имеет. Severity low оправдана: проблема только в документации, на поведение инструмента не влияет. Ссылки в suggested_fix согласуются с package.json repository.url (github.com/alisaosipova/mcp-review-check).

### F158 [low/bug] pack.test.ts требует git и каталог .git без skipIf — npm test падает из архива исходников

**Where.** `test/pack.test.ts:192` (reviewer: docs-tests-ci)

**What.** test/pack.test.ts:15 (а не :192: в файле всего 48 строк): cleanCopy() вызывает `execFileSync('git', ['ls-files','-z'], { cwd: ROOT })`, а describe('npm pack') на строке 25 не обёрнут в skipIf. Если .git нет (GitHub «Download ZIP», tarball исходников, Docker-контекст без .git) или git не установлен, тест падает с исключением `fatal: not a git repository` и не пропускается. В соседнем test/repo-config.test.ts:23 для того же случая есть `describe.skipIf(!existsSync(join(ROOT, '.git')))`. Опубликованного npm-пакета это не касается: test/ не попадает в package.json files.

**Evidence.** test/pack.test.ts:192 `execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })` без skipIf; test/repo-config.test.ts:23 `describe.skipIf(!existsSync(join(ROOT, '.git')))('repository config', …)`.

**Repro (verifier).**

```
cd /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/nogit && node -e "require('child_process').execFileSync('git',['ls-files','-z'],{cwd:process.cwd(),encoding:'utf8',stdio:['ignore','pipe','pipe']})"
-> Error: Command failed: git ls-files -z
   fatal: not a git repository (or any parent up to mount point /)
В cleanCopy() (test/pack.test.ts:15) тот же вызов, поэтому без .git тест 'npm pack from a clean copy...' падает, а не пропускается.
```

**Suggested fix.** Добавить тот же `describe.skipIf(!existsSync(join(ROOT, '.git')))` или fallback: список файлов из `npm pack --dry-run --json` плюс `package.json.files`.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — Утверждение подтверждается по существу, но номер строки в нём неверный: файл короче 48 строк, вызов git стоит на строке 15. Перед вызовом git в cleanCopy нет ни try/catch, ни проверки существования .git; в describe/it на строках 25–26 нет skipIf. В vitest.config.ts и package.json ("test": "vitest run") никакой обработки этого случая нет. Что тест намеренно требует git, нигде не сказано. Наоборот, в repo-config.test.ts:23 для той же зависимости от .git явно стоит skipIf, то есть для этого случая в проекте принято пропускать тест. В текущем дереве .git есть и git установлен (/usr/bin/git), так что прямо сейчас тест не падает. Падение возможно только при сборке из архива исходников, поэтому severity остаётся low.

### R001 [low/bug] Сервер, ждущий закрытия stdin, превращает полностью завершённую проверку в INCOMPLETE/exit 3 с ложной фазой «active tool calls» (даже без --active)

**Where.** `src/connect.ts:509` (reviewer: deadline-signals)

**What.** В buildStdio (src/connect.ts:501) `checkpoint(progress, 'active tool calls')` стоит вне `if (opts.active)`, а после него идут sleep 50 мс и `conn.client.close()`. GroupStdioTransport.close (стр. ~641) ждёт выхода сервера после EOF до 2 с. Если --max-duration истекает в этом хвосте, все проверки уже выполнены и snapshot полный. Но withDeadline/stoppedSnapshot всё равно ставит coverage 'stopped' и phase 'active tool calls', хотя --active не задан. Итог: exit 3 и Result INCOMPLETE, 16 правил пропущены как stopped. В HTTP-ветке финальные close()/tracer.flush() (стр. 368-369) приписываются последней фазе. Ложный результат возникает, только если дедлайн попадает в последние ~2 с прогона, поэтому это редкий край. Неверная метка фазы детерминирована в этом окне.

**Failure scenario.** CI запускает `--max-duration 60000 --stdio -- npx some-server`. Сервер держит таймер или HTTP-listener и не выходит по EOF. Проверка укладывается в 59 с, но close ждёт 2 с, и CI получает exit 3, INCOMPLETE и «during active tool calls», хотя флага --active не было.

**Evidence.** Сервер с KEEP=1 (живёт после EOF на stdin), без --active: полный прогон занимает 4.2 с, exit 1. Прогон с `--max-duration 3800` даёт exit=3 и выводит «stopped by --max-duration 3800 ms during active tool calls; later checks did not run.», «Checked 2 tools … 16 stopped by --max-duration», «Result: INCOMPLETE (stopped at --max-duration during active tool calls)». Находки при этом те же, что в полном прогоне (SPEC-009 есть, значит wire probes отработали). Лог: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/keepstop.3800.txt

**Repro (verifier).**

```
Сервер: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/srv.mjs. С KEEP=1 он не выходит по EOF. Флаг --active не задан.
Команда: `node dist/cli.js --max-duration <d> --format json --env KEEP=1 --stdio -- node srv.mjs`

| --max-duration | exit | время | limits | coverage | findings |
|---|---|---|---|---|---|
| нет | 1 | 4390 мс | None | — | [SPEC-009, SRV-002, TOOL-012, TOOL-018, TOOL-028] |
| 3800 | 3 | 4084 мс | stopped {maxDurationMs: 3800, phase: 'active tool calls'} | {toolLevel: 'stopped', reason: 'stopped by --max-duration (3800 ms) during active tool calls'} | тот же набор |
| 4300 | 1 | 4489 мс | None | toolLevel ok | тот же набор |

Набор находок во всех трёх прогонах одинаковый, то есть при 3800 все проверки завершились. Вывод: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/outR.3800.json
```

**Suggested fix.** После последней проверки ставить фазу 'closing' (checkpoint(progress,'closing')). Если таймер сработал в фазе 'closing', возвращать завершённый snapshot без пометки stopped. Как минимум ставить checkpoint 'active tool calls' только внутри `if (opts.active)`. В HTTP-ветке делать то же перед close/flush.

**Verifier votes.**

- *reader*: confirmed (conf 0.85) — Утверждение подтверждено, но вероятность невысокая, поэтому severity снижена до low.

Код:
- `checkpoint()` (стр. 74) только запоминает фазу или бросает Stopped.
- После последнего checkpoint в buildStdio нет фазы 'closing'.
- withDeadline (стр. ~548) при срабатывании таймера в любом случае возвращает stop. Есть строка `return progress.stopped ? stop : r`, то есть даже полностью завершённый run отбрасывается.
- Выше по стеку этот случай не обрабатывается.

Тесты и spec: в test/ (max-duration, e2e-stdio, e2e-http) проверяются только фазы connect, listing и tools re-list. Теста, где такое поведение в фазе закрытия считалось бы намеренным, нет. Метка 'active tool calls' без --active — явная ошибка.

Дубликат или нет: в known-round1 (04-round2/known-round1.json) есть F011 (один exit 3 для двух причин), F015/F162 (парсинг чисел), F031 (TLS-таймаут). Ни одна из них не про этот хвост, так что это не повтор.

Почему low: ложный INCOMPLETE получается, только если дедлайн попадает в окно примерно 2 с между концом проверок и выходом сервера. Это узкий край. В примере с CI и 60 с прогон должен уложиться в промежуток 58-60 с.
- *repro*: confirmed (conf 0.88) — Подтверждено фактическим прогоном против dist/cli.js (dist собран 06:39, src 05:13, логика та же: dist/connect.js:454 checkpoint 'active tool calls' стоит вне if (opts.active), :462 sleep 50 мс, :617 ожидание выхода до 2 с). checkpoint() только выставляет phase. Если таймер withDeadline срабатывает в хвосте buildStdio (sleep 50 мс плюс conn.client.close(), который ждёт выхода сервера после EOF на stdin до 2 с), то progress.stopped=true и stoppedSnapshot помечает прогон как stopped с phase='active tool calls'. Все проверки к этому моменту уже выполнены. Важная деталь для повторения: getDefaultEnvironment() не передаёт ребёнку произвольные переменные окружения, поэтому `KEEP=1 node cli ... -- node srv.mjs` не воспроизводит баг (прогон занимает 420 мс). Нужна обёртка `-- env KEEP=1 node srv.mjs`. С ней полный прогон занимает 4.37 с (exit 1). При --max-duration от 2500 до 3800 получаем exit 3 и INCOMPLETE «during active tool calls», хотя --active не было, и 16 правил помечены stopped. Набор находок при этом совпадает с полным прогоном (SPEC-009 на месте). Severity снижаю до low. Ложный INCOMPLETE бывает только тогда, когда дедлайн попадает в фиксированное окно около 2 с в конце прогона, а сервер не выходит по EOF. В CI при --max-duration с запасом это случается редко. Основной вред — неверный exit 3 и вводящий в заблуждение текст фазы. Для HTTP-ветки (src/connect.ts:368-369, close/flush после последнего checkpoint) я проверил только по коду, механизм тот же. Без живого HTTP-сервера не воспроизводил, а там close обычно быстрый, так что окно меньше. Попутное наблюдение: 2 с ожидания при закрытии каждого fresh() приходятся на фазу 'tools re-list'. Остановка там честно теряет toolsFreshConnection, потому что значение возвращается только после finally. Это частичный, но корректный stopped.

### R003 [low/bug] Остановленный snapshot теряет уже собранные данные (active-вызовы, wire probes, observedErrors, modernResults), и часть правил молча проходит, а не помечается stopped

**Where.** `src/connect.ts:649` (reviewer: deadline-signals)

**What.** Если --max-duration останавливает проверку во время wire probes, active-вызовов или поздних HTTP-фаз, stoppedSnapshot (src/connect.ts:649) теряет частично собранные данные. snap.transport.probes и snap.active присваиваются только после завершения runWireProbes/runActive целиком, а modernResults и observedErrors в остановленный snapshot не попадают вообще. Движок помечает правило как skipped только по needs и coverage, поэтому правила с выполненным needs (SPEC-009 с needs ['tools'], SPEC-016 с needs [], а также SPEC-012/013 при era modern) выполняются на пустых данных. Они молча считаются пройденными: их нет ни среди находок, ни среди skipped. При этом весь прогон всё равно помечен INCOMPLETE и завершается с exit 3.

**Failure scenario.** Сервер на unknown tool отвечает result вместо ошибки. При остановке в фазе wire probes отчёт не содержит SPEC-009 и не помечает его как пропущенный. Пользователь считает, что правило пройдено.

**Evidence.** Сценарий (2), `--max-duration 2000 --env DELAY_tools_call=5000`: limits.stopped.phase='wire probes'. SPEC-009 нет ни в findings, ни в skipped, хотя в полном прогоне он есть: «tools/call for a non-existent tool returned a result…». Сценарий (1), `--active --max-duration 3000 --env DELAY_tools_call=1000`: по логу сервера get_x ответил через 2265 мс после старта CLI, то есть до дедлайна. Тем не менее «12 RT rules skipped» с причиной 'stopped by --max-duration'. Код: probe/active.ts:79-103 копит calls[] локально и возвращает результат только в конце. Лог: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/EVIDENCE.txt

**Repro (verifier).**

```
Из /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/EVIDENCE.txt.

`== stop during wire probes`: limits.stopped = {maxDurationMs: 2000, phase: 'wire probes'}, «SPEC-009 in findings: [] in skipped: []». В полном прогоне SPEC-009 есть среди находок.

`== stop during active`: get_x ответил через 2265 мс после старта CLI, то есть раньше дедлайна в 3000 мс. Тем не менее «12 RT rules skipped» с причиной 'stopped by --max-duration'.

Код: probes присваиваются в connect.ts:344 и 486 только после await, правило SPEC-009 в spec.ts:201 имеет needs ['tools'], условие пропуска задаётся в engine.ts:30-37.
```

**Suggested fix.** Передавать в runActive/runWireProbes накопитель из progress (например progress.partialActive / progress.partialProbes) и копировать его в stoppedSnapshot. В stoppedSnapshot вызывать collectErrors(progress.tracer, rec) и копировать modern.results через progress. Правила, чьи данные собираются в незавершённой фазе, помечать skipped 'stopped by --max-duration' по фазе, а не только по coverage.

**Verifier votes.**

- *reader*: confirmed (conf 0.8) — Утверждение подтверждается кодом. src/connect.ts:649 stoppedSnapshot копирует live.transport.probes, но в HTTP-ветке (стр. 344) и stdio-ветке (стр. 486) snap.transport.probes присваивается только после того, как await runWireProbes целиком завершится. snap.active (362/503) присваивается так же. modernResults и observedErrors заполняются только в конце buildHttp/buildStdio (372-373, 511), а stoppedSnapshot их не трогает и collectErrors не вызывает. В движке (src/rules/engine.ts:25, 30-37) coverage 'stopped' даёт причину пропуска только тогда, когда не выполнено условие needs. Для needs:['tools'] достаточно listOk(listMeta.tools), а листинг к этому моменту уже завершён. Поэтому SPEC-009 (spec.ts:201, needs ['tools']) выполняется: probeRpc ничего не находит, правило возвращает [] и засчитывается в rulesRun как пройденное. Это видно в EVIDENCE.txt: при phase='wire probes' SPEC-009 нет ни в findings, ни в skipped. SPEC-016 (needs: []) работает так же. Для SPEC-012/013 нужен era modern; при остановке у них пустой modernResults. В test/incomplete.test.ts и test/max-duration.test.ts проверяются только строка Result и поле limits.stopped.phase, теста на то, что это поведение задумано, нет. docs/design/spec.md этот случай не описывает, а README:79 обещает «the report covers what ran». В известных находках раунда 1 похожих нет: F011, F015, F031 и F162 касаются других вопросов. Severity понижаю до low. Ошибка срабатывает только на пути, где сработал --max-duration. В этом случае отчёт и так помечен INCOMPLETE, указана фаза остановки, есть строка «later checks did not run», процесс завершается с exit 3. Пользователю не сообщают PASS, но список skipped и счёт rulesRun вводят в заблуждение, и уже полученные результаты active-вызовов теряются.
- *repro*: confirmed (conf 0.8) — Подтверждено по коду и воспроизведено. stoppedSnapshot (src/connect.ts:649-667) копирует live.transport.probes, но в stdio-пути snap.transport.probes присваивается только после завершения runWireProbes целиком (connect.ts:486), а в HTTP-пути — через spread после await (344-350). snap.active присваивается после завершения runActive (362, 503). modernResults и observedErrors заполняются только в конце buildHttp/buildStdio (372-373, 511), и stoppedSnapshot их не восстанавливает. При остановке coverage.toolLevel становится 'stopped', но engine.unmetNeed('tools') проверяет только listOk(snap,'tools') (engine.ts:36). Листинг успел пройти, поэтому SPEC-009 (needs:['tools']) выполняется. probeRpc(snap,'unknownTool') возвращает undefined, и правило отдаёт [] (spec.ts:207-209). В итоге правило молча «проходит»: его нет ни в findings, ни в skipped. То же следует из кода для SPEC-016 (needs: [], observedErrors пустой) и для SPEC-012/013 (modernResults), но их я не воспроизводил. Смягчает то, что общий вердикт отчёта — INCOMPLETE, а в тексте есть строка «stopped ... during wire probes; later checks did not run». Поэтому CI не получит зелёный результат. Но список skipped, из которого пользователь узнаёт, какие правила не выполнились, неверен для правил текущей фазы. Это неверный результат в реальном сценарии с --max-duration, поэтому severity medium. В known-round1 дубликата нет: F011, F031, F015 и F162 касаются кода выхода и разбора таймаутов, а не потери частичных данных.

### R004 [low/bug] После Ctrl+C/SIGTERM проверка stdio продолжается, пишет полный отчёт в --output с coverage 'ok' и только потом умирает с 130

**Where.** `src/cli.ts:362` (reviewer: deadline-signals)

**What.** После SIGINT/SIGTERM runCli не прерывается: обработчик только завершает stdio-серверы и вызывает process.exit() после grace. Если run успевает завершиться в этом окне, --output перезаписывается отчётом без признаков прерывания (coverage 'ok', limits нет), и лишь затем процесс умирает с 130. Exit-код остаётся ненулевым, так что на gate CI это не влияет, но артефакт вводит в заблуждение.

**Failure scenario.** Пользователь жмёт Ctrl+C. В report.json оказывается «полный» отчёт с coverage ok, в котором проверка tools/list на новом соединении не выполнена, и этот файл потом загружают как артефакт CI.

**Evidence.** Команда `node dist/cli.js --format json --output rep.json --env DELAY_initialize=1100 --env IGNTERM=1 --env CHILD=1 --env KEEP=1 --stdio -- node srv.mjs &`, затем через 1 с `kill -INT`. Итог: exit=130, в stderr «mcp-review-check: score 84/100 · … · report written to …/rep.j.json». В rep.j.json coverage={'toolLevel':'ok'}, limits=None, то есть никаких признаков прерывания. Повторяется при DELAY_initialize 700/900/1100.

**Repro (verifier).**

```
Только по коду: cli.ts:363 `void endAllNow(signalled).finally(() => process.exit())`, флаг прерывания в runCli отсутствует, cli.ts:327-333 пишет --output безусловно. Повтор автора (exit=130, rep.json с coverage ok) я не воспроизводил.
```

**Suggested fix.** В обработчике сигнала выставлять общий флаг/AbortController, который run проверяет в checkpoint (как --max-duration), и не писать --output/stdout после сигнала. Либо помечать snapshot как interrupted (coverage 'stopped', phase 'signal').

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.6) — Код подтверждает механизм. Обработчик сигнала в cli.ts:362-371 только вызывает endAllNow() (connect.ts:606). Тот выставляет ending=true, шлёт SIGTERM/SIGKILL группам и ждёт grace, а process.exit() вызывается лишь в .finally. AbortController или флага, который runCli проверял бы перед buildReport/writeFileSync, нет. Если run завершится внутри grace-окна (типичный случай: сервер игнорирует SIGTERM), отчёт будет записан в --output вместе со строкой summary, и только потом процесс умрёт с 130. Тест test/process-tree.test.ts:128 прямо говорит «After SIGINT the check went on», то есть продолжение run после сигнала известно. Но тесты проверяют только то, что серверы не переживают CLI, и не проверяют, что --output не пишется. Spec о сигналах ничего не говорит. Последствия смягчает то, что exit=130 всё равно ненулевой и CI увидит сбой. Плюс нужен узкий случай: сервер игнорирует SIGTERM или ответ уже в пути. Поэтому severity low. Утверждение, что правило server.ts:476 молча проходит на undefined, я не перепроверял.

### R005 [low/bug] isMain ложен при запуске без расширения (`node dist/cli`): CLI молча ничего не делает и выходит с 0

**Where.** `src/cli.ts:352` (reviewer: deadline-signals)

**What.** Node при запуске резолвит `dist/cli` в dist/cli.js, но process.argv[1] остаётся '/…/dist/cli'. realpathSync такого пути бросает ENOENT, catch возвращает false, и runCli не вызывается. Процесс завершается с кодом 0 без вывода, и CI воспринимает это как успешную проверку.

**Failure scenario.** Скрипт CI `node node_modules/mcp-review-check/dist/cli https://… --fail-on error` всегда «проходит» с exit 0, проверка фактически не выполняется.

**Evidence.** `node dist/cli --version` ничего не выводит, exit=0. `node dist/cli.js --version` выводит 0.1.0. Через симлинк без расширения работает (realpath разрешает симлинк).

**Repro (verifier).**

```
$ node dist/cli --version; echo exit=$?
exit=0
$ node dist/cli.js --version
0.1.0
```

**Suggested fix.** Сравнивать через `import.meta.url === pathToFileURL(realpathSync(...)).href` с фолбэком: при ошибке realpath пробовать argv[1] + '.js'. Ещё лучше вынести запуск в отдельный bin-файл без проверки isMain (например dist/bin.js вызывает runCli).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.9) — Воспроизведено. `node dist/cli --version` ничего не выводит и завершается с exit=0, а `node dist/cli.js --version` выводит 0.1.0. В isMain (cli.ts:352) realpathSync('…/dist/cli') бросает ENOENT, catch возвращает false, runCli не вызывается. Severity low: package.json bin и main указывают на dist/cli.js, и через npx, bin-симлинк или полный путь всё работает. Сбой только при ручном вызове без расширения, зато он тихий (exit 0), и CI может принять его за успешную проверку.

### R006 [low/docs-mismatch] Exit-коды 129/130/131/143 (выход по сигналу) не описаны ни в README, ни в --help

**Where.** `README.md:105` (reviewer: deadline-signals)

**What.** Exit-коды при выходе по сигналу (128+N: 130 SIGINT, 143 SIGTERM, 131 SIGQUIT, 129 SIGHUP; на Windows exitCode=128+n) намеренно реализованы в src/cli.ts:356-371, но таблица Exit codes в README.md:98-105 и блок Exit codes в HELP описывают только 0-3. Exit-код по сигналу упомянут только в CHANGELOG (130 для Windows).

**Failure scenario.** CI-скрипт с `case $?` обрабатывает только 0-3, и отмена задачи (143) попадает в ветку «неизвестная ошибка» или трактуется как падение линтера.

**Evidence.** Измерено: SIGINT → exit 130, SIGTERM → 143, SIGQUIT → 131 (Quit), SIGHUP → 129. `grep -n 130 README.md` ничего не находит; HELP, cli.ts:74-75: «Exit codes: 0 … 1 … 2 … 3 …».

**Suggested fix.** Добавить в таблицу README и в HELP строку: «128+N: прерван сигналом (130 Ctrl+C, 143 SIGTERM); stdio-серверы перед выходом завершены».

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.85) — Подтверждено. README.md:98-105 (таблица Exit codes) перечисляет только 0-3. Блок HELP в src/cli.ts ("Exit codes: 0 ... 1 ... 2 ... 3 ...") тоже. При этом src/cli.ts:356-371 намеренно завершает процесс тем же сигналом (комментарий: "die by the same signal (130, 131, 143)"), а на win32 ставит exitCode = 128+n. README.md:313 описывает только завершение группы процессов по SIGINT/SIGTERM/SIGHUP/SIGQUIT, без exit-кода. Код 130 для Windows упоминается только в CHANGELOG.md:112. Поведение намеренное, но не задокументировано в таблице и HELP. Тестов или пунктов spec, которые бы это опровергали, нет. С находками первого раунда (F011 и др.) не пересекается.

### R010 [low/bug] ModernClient принимает result с чужим id (одиночный JSON и SSE fallback msgs[0]) и не сообщает о несовпадении

**Where.** `src/protocol/modern.ts:143` (reviewer: sse-legacy-modern)

**What.** В src/protocol/modern.ts:84 (а не :143) ModernClient.request принимает result из ответа, чей id не совпадает с id запроса. Для одиночного JSON id не сверяется вовсе, для SSE используется fallback msgs[0] в trace.parseBody (trace.ts:132). Успешный ответ с чужим id не попадает в observedErrors, поэтому SPEC-016 его не видит. В итоге modern-only сервер, который не возвращает id запроса, получает чистый листинг tools/resources/prompts, хотя настоящий клиент 2026-07-28 не сопоставит такой ответ с запросом.

**Failure scenario.** Modern-only сервер с багом эха id получает чистый отчёт по листингу, хотя хосты не смогут с ним работать.

**Evidence.** g_wrongid.mjs (сервер всегда отвечает id:999):
request id 1 response id 999 -> listAll {"names":["a"]}
Код: modern.ts:143 `const msg = Array.isArray(exchange.json) ? exchange.json.find((m) => isObj(m) && m.id === id) : exchange.json;`

**Repro (verifier).**

```
Скрипт /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r010.mjs запускает локальный http-сервер, который всегда отвечает id:999 с result {tools:[{name:'a'}]}, и вызывает ModernClient из dist.
$ node r010.mjs
request id 1
json listAll {"names":["a"]}
$ node r010.mjs sse
request id 1
sse listAll {"names":["a"]}
Ошибки нет: оба ответа приняты.
```

**Suggested fix.** Если `msg.id !== id` (и это не error с id null), не принимать result. Записывать ObservedError/наблюдение «response id X does not match request id Y», чтобы SPEC-016 увидел его, а запрос считать неуспешным.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.85) — Подтверждено. Номер строки в утверждении устарел: файл src/protocol/modern.ts короче 143 строк. Нужный код находится на строке 84 src/protocol/modern.ts: `const msg = Array.isArray(exchange.json) ? exchange.json.find((m) => isObj(m) && m.id === id) : exchange.json;`. Для одиночного JSON-ответа id не сверяется. Для SSE trace.parseBody (src/protocol/trace.ts:132) возвращает `msgs.find(id match) ?? msgs[0]`, то есть при отсутствии совпадения берёт первое сообщение. После этого request() кладёт msg.result в res.result и в this.results, а listAll принимает страницу. Выше по стеку несовпадение тоже никто не ловит. collectErrors (src/connect.ts:255-263) записывает ObservedError только когда в сообщении есть error, а RecordingTransport.errors относится к SDK-пути. SPEC-016 (src/rules/spec.ts:367) сравнивает responseId и requestId только по observedErrors. Других проверок responseId для успешных ответов в src/rules нет: rpcView заполняет responseId, но для успешных ответов это поле никто не сравнивает. Тестов, которые фиксировали бы такое поведение как намеренное, не нашёл. spec.md этому не противоречит, а rationale самой SPEC-016 прямо требует «ids must echo the request». Влияние ограничено modern-only серверами: на dual-era сервере SDK-путь с неверным id упадёт и проблема проявится иначе. Сам баг эха id на сервере встречается редко, поэтому severity low оставляю.

### R013 [low/bug] Неполная проверка (auth-required / token-rejected) завершается exit 0 «PASS» и без GitHub-аннотации: просроченный или отсутствующий токен в CI даёт зелёный job

**Where.** `src/cli.ts:324` (reviewer: score-gate-github-explain)

**What.** Механизм подтверждён. Код выхода в src/cli.ts:324 зависит только от fatal/stopped и report.summary.failed, coverage.toolLevel в нём не участвует. annotations() в src/report/github.ts печатает аннотацию-причину только для fatal/stopped. Поэтому при token-rejected (bearer передан, получен 401) и без ошибок от AUTH-правил результат такой: Result «PASS (--fail-on …) · partial check: token-rejected», exit 0, score n/a, вердикты INCOMPLETE, ни одной ::warning/::error. Для auth-required (нет токена, в том числе секрет недоступен в PR из форка) такое поведение прямо задумано: spec.md §3.2 «A 401 without --bearer is not fatal… exit code follows --fail-on». Для token-rejected spec.md §3.4 требует только «тот же notice» и код выхода не оговаривает. README:91 прямо говорит, что partial check показывается в строке Result, так что PASS с пометкой partial check — задокументированное решение, а не случайность. Реальный пробел в UX для CI: явно переданный и отвергнутый токен (истёкший секрет) не делает job красным и не порождает аннотацию, хотя это ошибка конфигурации. Severity снижаю до low. Это проектное решение, частично описанное в документации. Строка Result и notice явно сообщают о неполной проверке. Сценарий с PR из форка по spec вообще считается задуманным.

**Failure scenario.** В workflow из README у secrets.MCP_REVIEW_CHECK_TOKEN истёк срок, или PR пришёл из форка. Сервер отвечает 401, auth-правила проходят, tool-проверки не запускаются, exit 0, аннотаций нет, PR проходит с «PASS».

**Evidence.** Мини-репро на dist (/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/gate.mjs → gate.out): buildReport со снапшотом coverage={toolLevel:'token-rejected'}, без находок, --fail-on warning → `PASS (--fail-on warning) · partial check: token-rejected (token rejected (401))`, score `n/a`, summary.failed=false, verdicts claude/chatgpt=INCOMPLETE. В cli.ts:324 `const code = snap.fatal || snap.limits?.stopped ? 3 : report.summary.failed ? 1 : 0;`, coverage не учитывается. В github.ts:228-241 outcome задаётся только для fatal/stopped. connect.ts:275 `if (opts.bearer)`: пустой MCP_REVIEW_CHECK_TOKEN эквивалентен отсутствию токена.

**Repro (verifier).**

```
Существующий /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/gate.out (buildReport на dist): случай 4 `PASS (--fail-on error) · partial check: auth-required (server requires auth; pass --bearer <token>) n/a … failed: false, verdicts INCOMPLETE`; случай 5 `PASS (--fail-on warning) · partial check: token-rejected (token rejected (401)) n/a (partial check: token-rejected) { e: 0, w: 0, i: 0, failed: false } claude/chatgpt INCOMPLETE`. По cli.ts:324 это даёт exit 0. В github.ts строка-причина mcp-review-check выдаётся только для fatal/stopped.
```

**Suggested fix.** Для token-rejected (токен передан, но отвергнут) возвращать отдельный ненулевой код (2 как ошибка конфигурации или 3) либо ввести флаг `--require-complete` / `--fail-on-incomplete`, при котором неполная проверка даёт exit 1. В режиме GITHUB_ACTIONS для любой неполной проверки печатать `::warning title=mcp-review-check::partial check: <toolLevel> (<reason>)`. В README (Exit codes, CI recipes) явно написать, что при auth-required и token-rejected exit = 0, и показать, как сделать job красным.

**Verifier votes.**

- *reader*: confirmed (conf 0.6) — Повтором раунда 1 находка не является. F011 про неразличимость exit 3, F005 и F006 про выбор между auth-required и token-rejected, про exit 0 при неполной проверке там ничего нет. Строка cli.ts:324 актуальна: `const code = snap.fatal || snap.limits?.stopped ? 3 : report.summary.failed ? 1 : 0`. token-rejected выставляется в connect.ts:314. В test/e2e-http.test.ts:142 тест token-rejected проверяет только текст notice, ни код выхода, ни аннотации он не проверяет, так что тестом намеренность exit 0 не подтверждается. Что опровергает находку частично: spec.md §3.2 прямо разрешает exit по --fail-on при 401 без --bearer, значит случай форка и пустого секрета (auth-required) работает так, как задумано. README:91 документирует, что partial check называется в строке Result, а README:158 говорит о вердикте INCOMPLETE, а не о Result или коде выхода. Что не опровергается: при token-rejected spec о коде выхода молчит, а для CI это тихий зелёный job без аннотации при явной ошибке конфигурации. Поэтому подтверждаю со severity low: это разумное улучшение, а не нарушение спецификации.
- *repro*: confirmed (conf 0.8) — Подтверждено на dist. Код выхода в cli.ts:324 (`snap.fatal || snap.limits?.stopped ? 3 : report.summary.failed ? 1 : 0`) не смотрит на coverage.toolLevel. annotations() в src/report/github.ts:21-25 формирует outcome только для fatal и stopped. При coverage token-rejected и отсутствии auth-находок получается Result «PASS», exit 0, аннотаций нет, verdict INCOMPLETE, score n/a. Для auth-required (401 без --bearer) так и задумано: spec.md:1154 говорит «A 401 without --bearer is not fatal... exit code follows --fail-on». Для token-rejected spec.md:1191 требует только того же уведомления, про код выхода там ничего нет. Значит, это пробел в замысле, а не нарушение спецификации. Практический вред реальный: у секрета в рецепте README:212-226 истёк срок или его отозвали, и job зелёный, хотя все проверки TOOL/INJ/DATA/POL/APPS пропущены. При этом README:166 обещает аннотации только для находок и для exit 3, а README:158 говорит «INCOMPLETE, never a pass» только про вердикт, так что документация формально не нарушена. Часть сценария про форк ослабляю. Событие deployment_status запускается в контексте базового репозитория, где секреты доступны. А пустой токен даёт auth-required, и это поведение задокументировано и задумано. Основной подтверждённый случай: явно переданный, но отвергнутый токен. Среди находок раунда 1 дубликата нет. Ближе всего F011 (exit 3 для двух разных причин), но это другое. Severity medium: в реальном CI-сценарии результат неверный, при этом безопасность не затронута и основной сценарий не ломается.

### R016 [low/bug] --list-rules <prefix> --format markdown печатает пустую таблицу правил или чек-листа (только заголовок)

**Where.** `src/explain.ts:36` (reviewer: score-gate-github-explain)

**What.** rulesMarkdown всегда выводит обе таблицы. При фильтре по префиксу, который совпадает только с MAN-пунктами или только с правилами, вторая таблица состоит из одного заголовка и разделителя, а для правил ещё и с подписью «Manual checklist».

**Failure scenario.** `mcp-review-check --list-rules MAN --format markdown > checklist.md`: в файле оказывается пустая таблица правил.

**Evidence.** lr.out: `--list-rules MAN-00 --format markdown` → `| ID | Title | Severity by platform | Source |\n|---|---|---|---|\n\n**Manual checklist** ...`. `--list-rules RT-001 --format markdown` → после таблицы правил идут «**Manual checklist** ...» и пустая таблица `| ID | Platform | Reminder |`.

**Repro (verifier).**

```
$ node dist/cli.js --list-rules MAN-00 --format markdown | head -8
| ID | Title | Severity by platform | Source |
|---|---|---|---|

**Manual checklist** (printed as reminders; never scored):

| ID | Platform | Reminder |
|---|---|---|
| MAN-001 | claude | Privacy policy URL ...
---
$ node dist/cli.js --list-rules RT-001 --format markdown
| ID | Title | Severity by platform | Source |
|---|---|---|---|
| RT-001 | Error messages are specific | claude: error | [link](...) |

**Manual checklist** (printed as reminders; never scored):

| ID | Platform | Reminder |
|---|---|---|
```

**Suggested fix.** В rulesMarkdown не выводить таблицу, если соответствующий список пуст: `if (rules.length)` / `if (manual.length)`.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.9) — Подтверждено. rulesMarkdown (src/explain.ts:38-43) всегда выводит обе шапки таблиц, проверок `rules.length`/`manual.length` в коде нет. В src/cli.ts:197-200 оба списка фильтруются по одному префиксу, и ошибка выдаётся только когда пусты ОБА списка. Если пуст только один, rulesMarkdown получает пустой массив, и соответствующая таблица остаётся из одного заголовка. В test/cli-rules.test.ts markdown проверяется только без префикса, когда оба списка заполнены, поэтому теста, который закреплял бы такое поведение как намеренное, нет. docs/RULES.md строится из полного каталога, и там дефект не проявляется. В spec.md вывод с фильтром не описан, а README прямо обещает фильтр по префиксу вида `MAN`. В известных находках первого раунда этой проблемы нет: про --list-rules там только находка о тексте ошибки для --format. Вывод получается синтаксически правильным markdown, просто с пустой таблицей. Это косметика.

### R019 [low/docs-mismatch] Таблица exit codes не упоминает, что непредвиденное исключение линтера тоже даёт exit 3

**Where.** `README.md:105` (reviewer: score-gate-github-explain)

**What.** cli.ts:337-347 переводит любое исключение, кроме UsageError и ERR_PARSE_ARGS, в exit 3 и печатает stack. В README (таблица Exit codes) и HELP (cli.ts:74-75) exit 3 описан только как «could not connect / stopped by --max-duration». Упоминание «an unexpected failure» есть только в разделе GitHub Actions. В CI внутренний баг линтера выглядит как недоступный сервер. F011 про это не говорит: там речь о connect против max-duration.

**Failure scenario.** Правило бросает исключение вне try (например, в buildReport/render), CI показывает exit 3, и разработчик сервера ищет сетевую проблему.

**Evidence.** cli.ts:343-347: `const fatal = `${stderr}fatal: ${(e as Error).stack ?? e}\n`; return { code: 3, ... }`. README:105: «3 | Could not reach the server or complete any handshake ..., or `--max-duration` stopped the check».

**Suggested fix.** Дописать в таблицу и HELP: «3 … or an unexpected internal error (stack on stderr; please report)», либо выделить для внутренних ошибок отдельный код (например 4).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.7) — Подтверждено. src/cli.ts (catch в конце runCli) переводит любое исключение, кроме UsageError и ERR_PARSE_ARGS, в code 3 со stack на stderr. Таблица README.md:105, FAQ README.md:284 («Why did the run exit 3?») и HELP называют для exit 3 только «could not connect» и «stopped by --max-duration». Внутренний сбой упомянут лишь мимоходом в разделе GitHub Actions (README.md:166: «or an unexpected failure») и в CHANGELOG:112 («exit 3 with `fatal:`»). Значит, документация знает об этом случае, но таблица и FAQ, к которым ведут ссылки «see Exit codes», его опускают. Это неполнота, а не прямое противоречие, поэтому severity low. F011 касается различения connect и max-duration, а F136 — конкретного RangeError. Пробел в документации ни одна из них не покрывает.

### R020 [low/docs-mismatch] --ignore повышает score, а README говорит только об исключении из exit code

**Where.** `README.md:282` (reviewer: score-gate-github-explain)

**What.** Ignored-находки намеренно исключаются из score (engine.ts:126, тест report.test.ts:126), поэтому --ignore повышает score вплоть до 100/100. README (строки 88, 282 и описание score на строке 158, где score назван «one number per server ... whatever --target») об этом не говорит, и score выглядит независимым от флагов запуска.

**Failure scenario.** Команда сравнивает score двух серверов, не зная, что у одного из них в CI стоит --ignore на 5 правил.

**Evidence.** gate.out, случай 3: правило X-3 claude=error с `--ignore X-3` → `PASS (--fail-on error) 100/100`, verdicts NO AUTOMATED BLOCKERS. engine.ts:126 `if (!ignore.has(rule.id)) scored.push(finding);`.

**Suggested fix.** В README (score и FAQ) указать: «ignored rules are left out of the score too». Опционально помечать score при непустом ignored (например, «87/100 (2 rules ignored)»).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.75) — Подтверждено как пробел в документации, хотя само поведение намеренное. src/rules/engine.ts:126 `if (!ignore.has(rule.id)) scored.push(finding);`. Тест test/report.test.ts:126 называется 'buildReport scores every platform whatever --target (deepwiki-like: one score); ignored rules do not count', то есть исключение ignored из score задумано. Но в README это не отражено: README.md:88 и :282 говорят только о JSON `ignored` и exit code, а README.md:158 подчёркивает «The score is one number per server: it counts the findings of every platform whatever --target». Это создаёт впечатление, что score не зависит от флагов запуска. Spec (docs/design/spec.md) и RULES.md про взаимодействие ignore и score ничего не говорят. От F129 (rootCauses нет в JSON) и F124 (исключение в правиле вне target) находка отличается.

### R021 [low/bug] Плюрализация в summary-строке: «1 errors · 1 warnings»

**Where.** `src/cli.ts:326` (reviewer: score-gate-github-explain)

**What.** Сводная строка при --output (cli.ts:326) и строка Score в text-отчёте (text.ts:149) всегда пишут множественное число, хотя рядом (score.ts plural, «root cause(s)») множественное число уже обрабатывается.

**Failure scenario.** Косметика: в каждом отчёте с одной ошибкой или одним предупреждением выводится «1 errors» или «1 warnings».

**Evidence.** Прогон runCli против локального 401-сервера (/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/s401.mjs): `Score n/a (partial check: auth-required) · 3 root causes · 2 errors · 1 warnings · 3 info`. cli.ts:326 `${s.errors} errors · ${s.warnings} warnings`.

**Repro (verifier).**

```
src/cli.ts:326: `mcp-review-check: score ${scoreLabel(report)} · ${s.errors} errors · ${s.warnings} warnings · ...` → при 1 ошибке выводит «1 errors».
```

**Suggested fix.** Использовать общий helper plural() (как в score.ts:51) в cli.ts:326 и text.ts:149.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.95) — Подтверждено по коду. cli.ts:326 содержит `${s.errors} errors · ${s.warnings} warnings`, text.ts:149 содержит `${s.errors} errors · ${s.warnings} warnings` без плюрализации, хотя в той же строке text.ts:149 есть `root cause${causes === 1 ? '' : 's'}`, а в text.ts:151 `error${x.errors === 1 ? '' : 's'}`. Тест test/root-causes.test.ts:65 закрепляет формат `errors · `, но проверяет общий случай, а не намеренное «1 errors». Это чистая косметика. В known-round1 дубля нет.

### R023 [low/bug] Пустое имя инструмента ('') даёт аннотацию с title «RULE-ID » без субъекта

**Where.** `src/report/github.ts:237` (reviewer: score-gate-github-explain)

**What.** src/report/github.ts:30 (а не :237): `f.tool ?? f.resource ?? 'server'` оставляет пустое имя инструмента как есть. Аннотация получает title вида «TOOL-003 » с хвостовым пробелом и без субъекта. У TOOL-001 субъект виден из message («tool name is empty»), у остальных правил по тому же инструменту — нет. Та же логика в subjectOf (src/rules/engine.ts:212).

**Failure scenario.** Сервер с инструментом без имени получает в GitHub аннотацию «TOOL-001 » без указания, к какому инструменту она относится.

**Evidence.** gate.out, случай 10: `["::error title=X-10 ::[claude] m%0AFix: fix"]`.

**Repro (verifier).**

```
node-скрипт против dist/report/github.js, finding {ruleId:'TOOL-003', tool:'', platforms:['claude'], severities:{claude:'error'}}, gate.platforms=['claude'] → ["::error title=TOOL-003 ::[claude] description missing%0AFix: add"]
```

**Suggested fix.** `const subj = f.tool || f.resource || 'server'` либо явная подпись `(empty name)` для пустой строки, одинаково в github.ts и subjectOf.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — Подтверждено. Указанная строка устарела: код находится в src/report/github.ts:30, а не на :237. Там `const title = `${f.ruleId} ${f.tool ?? f.resource ?? 'server'}``. Оператор ?? не заменяет '', а perTool/toolName (src/rules/tools.ts:23, src/rules/util/access.ts:12) передают в f.tool пустую строку как есть. Выше по стеку этот случай нигде не обрабатывается. Тестов, которые фиксировали бы такое поведение как намеренное, я не нашёл, и spec.md этому не противоречит. subjectOf (src/rules/engine.ts:212) устроен так же. Последствие смягчается для самого TOOL-001: его сообщение и так говорит «tool name is empty». Но любое другое правило, сработавшее на том же безымянном инструменте, даёт аннотацию без субъекта. Это косметика и редкий край, поэтому severity low.

### R024 [low/bug] TEXT_CAP → TOOL-017: обрезка длинного `pattern` делает валидную схему «does not compile» (spec error)

**Where.** `src/limits.ts:29` (reviewer: limits-apps)

**What.** capSnapshot/capStrings (src/limits.ts:29) режет любую строку длиннее 16 KB, включая `pattern`/`patternProperties` в inputSchema/outputSchema, и делает это до запуска правил (src/connect.ts:542). Если regex обрезан посередине, он перестаёт компилироваться, и TOOL-017 (src/rules/schema.ts:128) выдаёт spec=error «does not compile» на схему, которая на сервере валидна. Правило не знает, что поле было обрезано. Случай редкий (pattern больше 16 KB), но даёт ложную находку уровня error.

**Failure scenario.** Инструмент с `pattern` из 2000 альтернатив (~50 KB): реальная схема валидна, отчёт показывает spec error TOOL-017 «does not compile».

**Evidence.** /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2apps.out: `pattern length 50895 valid before cap: true`; до capSnapshot TOOL-017 — нет находок; capSnapshot -> [{"where":"tool pick","length":50895,"cap":16384}]; после: `TOOL-017 {"spec":"error"} inputSchema does not compile: Invalid regular expression: /^(?:(?:value_0_...`

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r024.mjs (dist/limits.js + dist/rules/schema.js TOOL_017.check): pattern из 2000 альтернатив, длина 26899.
len 26899
before []
[{"where":"tool pick","length":26899,"cap":16384}]
after [{"tool":"pick","path":"inputSchema","message":"inputSchema does not compile: Invalid regular expression: /^(?:(?:value_0_xx|value_1_xx|..."}]
```

**Suggested fix.** Не резать структурные ключевые слова схемы: пропускать в capStrings значения под ключами pattern, $ref, $id, $schema, format, const, enum[*], name (или резать только description/title/examples/default). Как вариант — запускать TOOL-017 на необрезанной копии, а если поле было обрезано, понижать результат до info с пометкой «truncated».

**Verifier votes.**

- *reader*: confirmed (conf 0.9) — Подтверждено. В src/limits.ts:17-34 capStrings без разбора режет любую строку длиннее TEXT_CAP (16384) в tool-объекте, в том числе `pattern` внутри inputSchema/outputSchema. Исключений по ключам нет. Вызывается в src/connect.ts:542 (capSnapshot(masked)) до запуска правил. Ниже по стеку TOOL-017 (src/rules/schema.ts:104-136) проверяет уже обрезанную схему: invalidPattern компилирует regex с флагом u и выдаёт spec=error «does not compile». Обрезан ли был pattern, правило не проверяет и до info не понижает. Тесты test/limits.test.ts проверяют обрезку только у description и не показывают, что ломать pattern задумано. spec.md (TOOL-017, §492) называет невалидный pattern ошибкой, а обрезку описывает как защиту heuristic-регулярок, а не как изменение семантики схемы. Среди находок раунда 1 дубликата нет: F146 и F013 по limits.ts касаются покрытия и момента применения caps. Есть смягчающий фактор: limitsNotice в отчёте сообщает о «truncated before pattern checks», но сама находка TOOL-017 остаётся error и может дать exit 1 в CI. Severity понижаю до low: pattern длиннее 16 KB на практике встречается редко (обычно используют enum), это редкий край, хотя результат при этом неверный, уровня error.
- *repro*: confirmed (conf 0.9) — Не дубликат: в known-round1.json для src/limits.ts есть только F146 и F013, обе про недостаточное покрытие лимитами, а не про ложную ошибку из-за обрезки. Код подтверждает механизм. capStrings (src/limits.ts:27-29) режет любую строку длиннее TEXT_CAP=16384 через v.slice(0, cap), и `pattern` внутри inputSchema/outputSchema не исключён. connect.ts:542 вызывает capSnapshot до запуска правил. TOOL-017 (src/rules/schema.ts:128) затем вызывает invalidPattern, а тот делает new RegExp(p,'u') на обрезанной строке. Обрыв посередине незакрытой группы `(?:` даёт SyntaxError, и правило выдаёт spec=error «does not compile». Воспроизведено против dist: до capSnapshot находок нет, после него появляется ложная находка. Смягчающие факторы: limitsNotice сообщает об обрезке («truncated before pattern checks»), а regex длиннее 16 KB в реальных схемах встречается редко. Чаще большие списки задают через enum, а элементы enum по 16 KB не бывают. Поэтому снижаю severity до low (редкий край). Но если случай возникает, итог неверный и жёсткий: ложный spec error влияет на score и exit-код в --fail-on.

### R025 [low/bug] TEXT_CAP → TOOL-003/TOOL-001/TOOL-002: обрезка имени даёт ложные дубли и неверную длину в сообщениях

**Where.** `src/limits.ts:29` (reviewer: limits-apps)

**What.** `name` тоже попадает под обрезку. Два разных инструмента с одинаковыми первыми 16384 символами имени становятся одинаковыми: TOOL-003 сообщает «name appears 2 times» (chatgpt error). TOOL-001 и TOOL-002 пишут «name is 16384 characters» вместо реальной длины, а `tool` в находке — это обрезанная строка длиной 16 KB.

**Failure scenario.** Сервер с двумя сгенерированными инструментами с именами >16 KB и общим префиксом: ложный TOOL-003 error для chatgpt и неверная длина в TOOL-001/002.

**Evidence.** r2apps.out (секция cap): `TOOL-003 name appears 2 times | tool len 16384`, `TOOL-001 name is 16384 characters (> 128)`, `TOOL-002 name is 16384 characters (> 64)` для имён длиной 16484 символа (a×16484+'_one'/'_two').

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2apps.mjs cap -> 'TOOL-003 name appears 2 times | tool len 16384', 'TOOL-001 name is 16384 characters (> 128)', 'TOOL-002 name is 16384 characters (> 64)' для имён 'a'x16484+'_one'/'_two'
```

**Suggested fix.** Не обрезать `name`/`uri`/`uriTemplate` (это идентификаторы, а не текст для regex): сохранять оригинальную длину или ограничивать имя отдельно, после проверок длины. Как минимум — писать в сообщениях «over 16384».

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — Подтверждено. capStrings (src/limits.ts:25-29) обходит все строковые значения инструмента, в том числе `name`, и обрезает их до TEXT_CAP=16384. Вызов capSnapshot (connect.ts:542) стоит до правил. TOOL-003 (tools.ts:63) считает дубли по обрезанному toolName, TOOL-001/002 (tools.ts:39,50) выводят длину обрезанной строки. В rules/tools.ts есть обработка «over TEXT_CAP», но только для description (tools.ts:169) и instructions (server.ts:358), а для имени её нет. В test/limits.test.ts нет теста, который закреплял бы такое поведение для имён. Severity low: имена длиннее 16 KB с общим префиксом встречаются крайне редко. TOOL-001/002 всё равно срабатывают правильно, ошибочна только цифра в сообщении. Реальное ложное срабатывание даёт только TOOL-003 (chatgpt error).

### R026 [low/bug] TEXT_CAP → APPS-001/003/007/019: обрезанный ui:// URI или имя расходятся с необрезанными ключами resourceReads и toolsWithoutUi

**Where.** `src/limits.ts:39` (reviewer: limits-apps)

**What.** capStrings обрезает `_meta.ui.resourceUri` у инструмента и `uri` у записи resources/list, но не ключи `snap.resourceReads` и не `toolsWithoutUi` (их capSnapshot не обходит). uiResources ищет read по обрезанному URI и получает undefined. В результате APPS-001 молчит (`if (!r.read) continue`), а APPS-003/004/007/014/015 вообще не видят HTML — origin, который не задекларирован, пропадает из отчёта. APPS-019 сравнивает обрезанное имя из snap.tools с полным из toolsWithoutUi и ложно сообщает, что инструмента нет в text-only списке.

**Failure scenario.** Инструмент с именем >16 KB, который есть в обоих tools/list: ложное предупреждение APPS-019. UI-ресурс с URI >16 KB: пропущены все HTML-проверки.

**Evidence.** r2apps.out: длинный ui:// URI (16 KB+): до cap — `APPS-007 ... resource origin https://evil.cdn.example is not declared`, после cap — `(no findings)`. `APPS-019 after cap with long name present in both lists` → `APPS-019 {spec:warning, chatgpt:warning} listed only for clients that declare io.modelcontextprotocol/ui`.

**Repro (verifier).**

```
r2apps.out: '## long ui:// uri before cap' -> 'APPS-007 ... resource origin https://evil.cdn.example is not declared in the CSP'; '## after cap' -> '(no findings)'; '## APPS-019 after cap with long name present in both lists' -> 'APPS-019 {spec:warning, chatgpt:warning} listed only for clients that declare io.modelcontextprotocol/ui'
```

**Suggested fix.** Исключить идентификаторы (uri, resourceUri, outputTemplate, name) из обрезки или применять ту же обрезку к ключам resourceReads и к toolsWithoutUi (связано с F013, но здесь ложные срабатывания, а не только отсутствие лимита).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.75) — Подтверждено. capSnapshot обрезает `_meta.ui.resourceUri` у инструмента и `uri` у ресурса (src/limits.ts:39,41). Ключи snap.resourceReads остаются полными: они проставляются при чтении до cap, а в строке 48 обрезается только содержимое. toolsWithoutUi capSnapshot не обходит вообще. Поэтому uiResources не находит read по обрезанному URI, и все HTML-проверки молчат: в repro APPS-007 до cap есть, после cap находок нет. APPS-019 (apps.ts:415-418) сравнивает обрезанное имя из snap.tools с полным из toolsWithoutUi и выдаёт ложное предупреждение. Ни тесты, ни spec такое поведение не оправдывают. Это отдельная проблема от F013: там речь о том, что toolsWithoutUi не ограничен, а здесь — о рассинхроне идентификаторов между обрезанными и необрезанными частями снапшота. Severity low: нужны URI или имена длиннее 16 KB.

### R027 [low/bug] HTML_CAP → APPS-014: ложное «uses the ext-apps App but never calls connect()» для виджета больше 2 MB

**Where.** `src/limits.ts:54` (reviewer: limits-apps)

**What.** HTML обрезается до 2 MB, и APPS-014 проверяет наличие `.connect(` только в обрезанном тексте, не учитывая snap.limits.truncated. Если `new App(` или строка '@modelcontextprotocol/ext-apps' стоят в первых 2 MB, а все вызовы `.connect(` находятся после среза, получаем ложный claude warning «never calls connect()». В бандлах, куда класс App из ext-apps вшит целиком, его внутренний `super.connect(` обычно стоит до среза. Поэтому на практике это затрагивает в основном виджеты с внешним импортом ext-apps и большим объёмом встроенных данных.

**Failure scenario.** Single-file Vite-бандл на 2.5 MB, где `new App(` в начале, а `app.connect()` в конце: ложный claude warning.

**Evidence.** r2apps.out: `HTML > cap before: APPS-014 (no findings)`; после capSnapshot — `APPS-014 {"claude":"warning"} uses the ext-apps App but never calls connect()`.

**Repro (verifier).**

```
r2apps.out: '## HTML > cap before: APPS-014' -> '(no findings)'; '## HTML > cap after: APPS-014' -> 'APPS-014 {"claude":"warning"} uses the ext-apps App but never calls connect()'
```

**Suggested fix.** Если ресурс был обрезан (есть запись в snap.limits.truncated для этого URI), APPS-014 не выдаёт «never calls connect()» или понижает его до info с пояснением «content truncated».

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.6) — Механизм воспроизводится. APPS-014 (apps.ts:325-327) ищет `.connect(` в обрезанном до HTML_CAP тексте и не смотрит на snap.limits.truncated, поэтому после cap появляется claude warning, которого не было до cap. Реальная область меньше, чем в описании. В обычном single-file бандле код класса App из ext-apps, который сам вызывает `super.connect(...)` (это совпадает с `\.connect\s*\(`), стоит перед пользовательским кодом с `new App(`. Если `new App(` попал в первые 2 MB, туда обычно попадает и `.connect(` из библиотеки. Ложное срабатывание остаётся для виджетов, которые импортируют ext-apps извне (CDN или esm.sh) и раздуты встроенными ассетами (base64 и т.п.) между `new App(` и `app.connect()`. Оговорка: исходники ext-apps на хосте не найдены, наличие `super.connect` в классе App проверено по памяти, а не по коду. Severity low.

### R028 [low/security] capStrings не ограничивает ключи объектов: имена свойств и ключи patternProperties любой длины проходят мимо капа

**Where.** `src/limits.ts:25` (reviewer: limits-apps)

**What.** Обрезаются только значения (`rec[k] = v.slice`), ключи остаются как есть. Имя свойства inputSchema.properties или ключ patternProperties длиной в мегабайты доходит до regex-правил (TOOL-023 METHOD_PROP, DATA-* по именам параметров) и до `new RegExp(k,'u')` в invalidPattern, а в limits.truncated это не отражается. Заявленная цель limits.ts — защитить regex-эвристики от огромного ввода — обходится одним ключом. F013 и F146 говорят о непокрытых полях снапшота, а не о ключах.

**Failure scenario.** Сервер отдаёт inputSchema с именем свойства на 4 MB: все правила по именам параметров гоняют regex по 4 MB строке, а отчёт не упоминает усечение.

**Evidence.** /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2b.out: `truncated: [] key len after cap: 4194304` — ключ properties длиной 4 MB и ключ patternProperties длиной 1 MB не обрезаны и не попали в отчёт об усечении.

**Repro (verifier).**

```
r2b.out: 'truncated: [] key len after cap: 4194304'. Мой замер /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r28t.mjs: 'p*4MB truncated 0 ms 191 findings 7 maxmsglen 4194352'; 'a-b- 1MB truncated 0 ms 1254 findings 7 maxmsglen 1048624'. Скрипт r28s.mjs: время растёт линейно, 2 MB ключ — 2320 ms
```

**Suggested fix.** В capStrings пересоздавать объект, если какой-то ключ длиннее cap (обрезать ключ, сохранить коллизии с суффиксом), и учитывать это в `longest`; либо отбрасывать такие свойства с записью в truncated.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.75) — Подтверждено. capStrings (src/limits.ts:25-29) обрезает только значения, а Object.keys остаются как есть. Ключ properties на 4 MB и ключ patternProperties на 1 MB проходят через cap без изменений, и limits.truncated остаётся пустым. Мой замер показал, что ReDoS нет. Время правил растёт примерно линейно: 0.26 MB — 235 ms, 0.5 MB — 422 ms, 1 MB — 1301 ms, 2 MB — 2320 ms для ключа 'a-'*n. Так что ущерб — это обход заявленного лимита: секунды на правила, находки с сообщениями по 1–4 MB (maxmsglen 4194352) и никакого уведомления об усечении. Это отдельная проблема от F013/F146: они про непокрытые поля, а здесь про ключи внутри покрытых объектов. Severity low.

### R030 [low/bug] Content item с uri, отличным от запрошенного: _meta item-а игнорируется, HTML-правила молча пропускаются, APPS-005/012 дают ложные error

**Where.** `src/rules/util/ui.ts:129` (reviewer: limits-apps)

**What.** src/rules/util/ui.ts:47 (в файле 93 строки, не 129). uiResources выбирает content item строго по `c.uri === r.uri`. Если resources/read вернул единственный item с другим uri (например `ui://w/a.html?v=2`), то r.item = undefined, r.html = undefined, а r.meta берётся из list-entry или остаётся {}. Из-за этого HTML-правила (APPS-003/004/007/013..016, проверки `if (!r.html) continue/return []`) молча ничего не проверяют. APPS-005 и APPS-012 (проверка `!r.item && !r.listEntry`, apps.ts:104/274) при наличии list-entry выдают ложные «no CSP»/«no widget domain», хотя CSP объявлена в _meta этого item-а. APPS-001 (apps.ts:32) корректно сообщает «no content item with a matching uri», и это совпадает со spec.md:724. Поэтому пользователь получает error-сигнал, и после исправления uri повторный прогон покажет остальное. Дефект в том, что в одном отчёте вместе с этим сигналом идут ложные error и пропущенные реальные нарушения. Не дубликат F100: там _meta item-а и list-entry не сливаются, здесь item не находится вовсе.

**Failure scenario.** Сервер добавляет cache-buster к uri в ответе read: отчёт показывает ложные «no CSP»/«no widget domain» и пропускает недекларированные origin-ы.

**Evidence.** r2apps.out, `single content item, uri differs: cascade`: при item `{uri:'ui://w/a.html?v=2', _meta:{ui:{csp:{}}}, text:'<script src="https://evil.example/x.js"> ... alert(1)'}` выдаются только APPS-001, APPS-005 chatgpt error «no CSP declared», APPS-012 error, APPS-018, APPS-017 info; нет APPS-007 и APPS-015.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r030.mjs (uiResources из dist/rules/util/ui.js; read возвращает один item uri='ui://w/a.html?v=2' с _meta.ui.csp и <script src=https://evil.example/x.js>alert(1)) → вывод: `ui://w/a.html item= false html= undefined meta= {}`
```

**Suggested fix.** Если contents содержит ровно один item (или ровно один с mimeType text/html*), использовать его как fallback для html/meta. APPS-001 оставить как сигнал о несовпадении uri.

**Verifier votes.**

- *reader*: confirmed (conf 0.65) — Код подтверждает утверждение: ui.ts:47 матчит строго по uri, fallback-а на единственный item нет. Выше по стеку случай не обрабатывается: APPS-005/012 проверяют `!r.item && !r.listEntry` и при наличии list-entry идут дальше с пустой/list meta, HTML-правила пропускают при `!r.html`. spec.md:724 требует от APPS-001 флагать отсутствие item с совпадающим URI, то есть строгий матч задуман для APPS-001. Каскад на другие правила в спеке не описан и не выглядит намеренным. В test/ теста на этот случай не нашёл. Severity снижаю до low: сценарий редкий (серверы обычно возвращают тот же uri), а APPS-001 уже даёт error, указывающий на корень проблемы. Номер строки в утверждении устарел (47, не 129).
- *repro*: confirmed (conf 0.75) — Совпадений с находками первого раунда нет. Файла known-round1.json по указанному пути нет, но поиск по 01-find-raw дал только нерелевантные F029/F130. Код ui.ts:47 действительно ищет item строго по `c.uri === r.uri` и не имеет fallback на единственный item. Поведение воспроизведено на dist/. В контрольном прогоне (uri совпадают) выдаются APPS-007 (evil.example) и APPS-015 (alert). Если у item uri = `?v=2`, эти находки пропадают, а вместо них появляются ложные APPS-005, APPS-012 и APPS-017, хотя у item есть csp, domain и prefersBorder=true. Каскад реальный. Почему severity снижена до low: условие редкое, сервер должен ответить на read с другим uri. Кроме того, APPS-001 (spec error) прямо указывает на корневую причину, и после её исправления остальные находки становятся корректными. Строка 129 в утверждении не существует: файл 93 строки, реальная строка 47.

### R033 [low/bug] APPS-006: незашифрованный `ws://` в connectDomains не помечается (проверяется только `http:`)

**Where.** `src/rules/apps.ts:141` (reviewer: limits-apps)

**What.** APPS-006 помечает только `http://`, а `ws://` на публичный хост проходит без находки. На практике в https-sandbox хоста такое соединение блокируется как mixed content, поэтому виджет молча не подключится к realtime-эндпоинту, а линтер не предупредит. Нужно помечать `ws:` так же, как `http:` (кроме loopback).

**Failure scenario.** connectDomains: ["ws://realtime.example.com"]: виджет передаёт данные по нешифрованному каналу, а отчёт чистый.

**Evidence.** r2apps.out, секция `APPS-006 entries`: для `ws://api.example.com` нет ни одной строки (сравните с другими значениями того же списка).

**Repro (verifier).**

```
node: new URL('ws://realtime.example.com') -> proto=ws: host=realtime.example.com path="/"; BROAD и wildcard-regex не совпадают, условие line 141 (`=== 'http:'`) ложно -> ни одной находки.
```

**Suggested fix.** `if ((u.protocol === 'http:' || u.protocol === 'ws:') && !isLoopbackHost(u.hostname))` → `uses ${u.protocol}//`.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.7) — Строка актуальна: в src/rules/apps.ts:141 проверка схемы — только `u.protocol === 'http:'`. `ws://realtime.example.com` не попадает в BROAD и под wildcard-regex, парсится как URL с protocol 'ws:' и pathname '/', поэтому ни одна ветка не срабатывает. В spec.md §APPS-006 явно указан только `http://`, но fix правила («List exact https origins») и BROAD, где есть `wss://*`, показывают, что смысл правила — требовать шифрованные origin; теста, который разрешал бы ws://, нет. Однако failure_scenario преувеличен: виджеты ChatGPT/Claude работают в https-sandbox, и браузер блокирует ws:// из https-контекста как mixed content. Поэтому данные по открытому каналу не уйдут: соединение просто не установится. Это пропущенная битая запись, а не утечка.

### R034 [low/bug] APPS-006: wildcard в середине или в конце хоста (`https://api.*.example.com`, `https://*.example.*`) и `data:`/`blob:` обрабатываются неверно

**Where.** `src/rules/apps.ts:140` (reviewer: limits-apps)

**What.** `v.replace('*.', 'wildcard.')` заменяет только первое вхождение, а WHATWG URL принимает `*` в hostname. Поэтому `https://api.*.example.com` считается валидным origin (в CSP такой wildcard недопустим: хост просто не совпадёт), выдаётся лишь spec info. `data:` и `blob:` получают вводящее в заблуждение «has a path, query, fragment or trailing slash» (pathname ''), а не «scheme-source, not an origin / overly broad».

**Failure scenario.** resourceDomains: ["https://cdn.*.example.com"]: хост такую запись отбросит или не сопоставит, ресурсы не загрузятся, а линтер считает её корректной.

**Evidence.** r2apps.out: `https://api.*.example.com` и `https://*.example.*` → только `{spec:info} wildcard ... outside resourceDomains`; `new URL https://api.*.example.com host= api.*.example.com`; `connectDomains: "data:" has a path, query, fragment or trailing slash`, то же для `blob:`.

**Repro (verifier).**

```
node: 'https://api.*.example.com' -> wild=null, host=api.wildcard.example.com, path="/" (без находок в resourceDomains); 'https://*.example.*' -> wild[2]='example.*', host=wildcard.example.*; 'data:'/'blob:' -> proto=data:/blob:, path="" -> ветка «has a path...».
```

**Suggested fix.** Разрешать `*` только как ведущую метку (`^\*\.`), иначе → «invalid wildcard». Схемы без `//` (`data:`, `blob:`, `mediastream:`) отдельно помечать как scheme-source (overly broad / not an origin).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.65) — Подтверждено чтением кода и node-репро. Regex wildcard `^([a-z]+://)?\*\.(.+)$` распознаёт только ведущий `*.`. `https://api.*.example.com` после `replace('*.','wildcard.')` превращается в валидный `api.wildcard.example.com`; в resourceDomains это вообще не даёт находки, в других полях — только spec info. `https://*.example.*`: wild[2]='example.*' содержит точку и не входит в SHARED_HOST_SUFFIXES, поэтому запись не считается overly broad, а URL парсится (host `wildcard.example.*`). В CSP host-source wildcard допустим только как ведущая метка, так что такая запись не сработает. `data:` и `blob:` получают pathname '' и сообщение «has a path, query, fragment or trailing slash», что вводит в заблуждение (хотя находка всё же есть). Тестов на такие случаи нет, spec их не оговаривает. Сценарий редкий, по сути косметика и пропуск края.

### R037 [low/bug] APPS-015: navigator.clipboard помечается даже при объявленном `ui.permissions.clipboardWrite`; alert() в комментарии тоже срабатывает

**Where.** `src/rules/apps.ts:342` (reviewer: limits-apps)

**What.** Правило не смотрит r.ui.permissions, хотя его собственный fix советует «request clipboardWrite permission if needed», а APPS-017 признаёт clipboardWrite легальным ключом. Виджет, который корректно запросил разрешение, всё равно получает warning. Кроме того, regex работает по сырому HTML без stripComments: `// never use alert() here` → «uses blocked browser API: alert(». Это отличается от F108 (пользовательские функции).

**Failure scenario.** Виджет с кнопкой «Copy» и объявленным clipboardWrite получает предупреждение, которое противоречит fix-тексту самого правила.

**Evidence.** r2apps.out: `APPS-015 clipboard with permissions.clipboardWrite` → `APPS-015 {chatgpt:warning} uses blocked browser API: navigator.clipboard`; `APPS-015 alert in comment` → `uses blocked browser API: alert(`.

**Repro (verifier).**

```
node: regex /(^|[^.\w])(window\.)?(alert|confirm|prompt)\s*\(/m на '<script>// never use alert() here\n navigator.clipboard.writeText(x)</script>' -> match ' alert(' (в комментарии).
```

**Suggested fix.** Пропускать navigator.clipboard(.writeText|.write), если `isObj(r.ui.permissions?.clipboardWrite)`; диалоги искать в stripComments(r.html).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.6) — Строка 342 актуальна: regex применяется к сырому r.html, r.ui.permissions не проверяется. Fix самого правила советует «request clipboardWrite permission if needed», а APPS-017 и spec (§APPS-017) признают clipboardWrite легальным ключом. Поэтому виджет, который объявил разрешение, всё равно получает warning, и это расходится с собственным fix-текстом. Spec §APPS-015 описывает detect без учёта permissions, поэтому поведение соответствует spec буквально, но spec и fix противоречат друг другу. Учитывает ли ChatGPT clipboardWrite, не проверено, отсюда умеренная уверенность. Часть про комментарии подтверждена: в соседнем APPS-014 используется stripComments, а в APPS-015 нет, и `// never use alert() here` срабатывает. Это отличается от F108, где речь о пользовательских функциях. Тестов, закрепляющих такое поведение, нет: в test/rules/apps.test.ts есть только pos `alert("hi")` и neg `dialog.prompt`. Последствие — ложный warning только для платформы chatgpt.

### R038 [low/bug] APPS-019 приписывает UI-капабилити отсутствие инструмента, которого нет и в обычном новом соединении (toolsFreshConnection)

**Where.** `src/rules/apps.ts:418` (reviewer: limits-apps)

**What.** Правило сравнивает toolsWithoutUi с snap.tools первой сессии. Если сервер отдаёт разный набор инструментов на разных соединениях (per-session/динамические tools, feature flags), инструмент может отсутствовать и в toolsFreshConnection (новое соединение с полными капабилити). Тогда причина не в отсутствии UI-расширения, но APPS-019 всё равно выдаёт spec/chatgpt warning с неверным объяснением.

**Failure scenario.** Сервер с инструментами, привязанными к сессии: ложное предупреждение «нет text-only fallback».

**Evidence.** r2apps.out: `APPS-019: tool absent also from fresh full-capability connection` (toolsFreshConnection=['search'], toolsWithoutUi=[search], tools=[show,search]) → `APPS-019 {spec:warning, chatgpt:warning} listed only for clients that declare io.modelcontextprotocol/ui`.

**Suggested fix.** Базой сравнения брать пересечение snap.tools и snap.toolsFreshConnection (если оно есть); если инструмента нет и во fresh-соединении, пропускать (это зона SRV/TOOL-нестабильности).

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.6) — В src/connect.ts:356-358 собираются snap.toolsFreshConnection (новое соединение с полными капабилити) и snap.toolsWithoutUi (новое text-only соединение). APPS-019 (apps.ts:414-421) сравнивает toolsWithoutUi только с snap.tools первой сессии и toolsFreshConnection не смотрит. Если инструмента нет и во fresh-соединении с полными капабилити, его отсутствие в text-only списке нельзя приписать UI-расширению, но APPS-019 всё равно выдаёт spec/chatgpt warning с объяснением «listed only for clients that declare io.modelcontextprotocol/ui». Одновременно SRV (server.ts:476) уже сообщает «different set on a fresh connection», то есть данные для разграничения есть и не используются. Тест APPS-019 не задаёт toolsFreshConnection, поэтому поведение не закреплено. Сценарий требует недетерминированного сервера, поэтому редкий: low.

### R040 [low/bug] APPS-016: нет Google Analytics/GTM в списке трекеров; `data-alt=` засчитывается как alt

**Where.** `src/rules/apps.ts:363` (reviewer: limits-apps)

**What.** Сопоставление `\balt\s*=` в APPS-016 (src/rules/apps.ts:363) засчитывает `data-alt=` (а также `aria-alt=` и т.п.) как атрибут alt: граница слова проходит между '-' и 'a'. Поэтому `<img data-alt=...>` без настоящего alt не помечается. Пропуск googletagmanager.com и google-analytics.com в TRACKERS совпадает со списком в docs/design/spec.md §APPS-016 (doubleclick.net, googlesyndication.com, adservice.google.com, facebook.net). Значит, это неполнота спецификации, а не расхождение кода с ней. Как дополнение к списку трекеров предложение разумно.

**Failure scenario.** Виджет с gtag.js проходит APPS-016 без предупреждения о трекере.

**Evidence.** r2apps.out, `APPS-016 GA/GTM`: HTML с `<script src="https://www.googletagmanager.com/gtag/js?id=G-1">` и `<img src="x.png" data-alt="y">` → `(no findings)`.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2.mjs
16 gtag+data-alt []
16 control img [{"resource":"ui://w","message":"<img> without alt"}]
```

**Suggested fix.** Добавить googletagmanager.com, google-analytics.com, connect.facebook.net (уже покрыт facebook.net), hotjar.com, segment.com и т.п.; alt искать как `(?:^|\s)alt\s*=`.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.75) — Repro против dist подтверждает обе части: HTML с gtag.js и `<img src="x.png" data-alt="y">` даёт [], контроль `<img src="x.png">` даёт '<img> without alt'. Ошибка с alt — настоящий баг регулярного выражения. Список трекеров соответствует spec.md, поэтому это скорее улучшение. Подсказка уровня info/warning, значит severity low.

### R041 [low/bug] APPS-012: общий sandbox-домен в другом регистре (`HTTPS://WEB-SANDBOX.OAIUSERCONTENT.COM`) не распознаётся

**Where.** `src/rules/apps.ts:286` (reviewer: limits-apps)

**What.** Валидность проверяется через URL (регистр нормализуется), а сравнение с общим доменом идёт по сырой строке с учётом регистра. Неуникальный домен в верхнем или смешанном регистре проходит без warning.

**Failure scenario.** openai/widgetDomain с общим sandbox-доменом в другом регистре не получает предупреждение «not unique».

**Evidence.** r2apps.out: `APPS-012 shared sandbox uppercase` → `(no findings)`.

**Repro (verifier).**

```
12 upper []  (openai/widgetDomain='HTTPS://WEB-SANDBOX.OAIUSERCONTENT.COM')
12 lower [{"severity":"warning","message":"widget domain is the shared default sandbox (not unique)"}]
```

**Suggested fix.** Сравнивать `new URL(d).origin === 'https://web-sandbox.oaiusercontent.com'`.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — В src/rules/apps.ts:286 валидность проверяется через new URL (схема и хост приводятся к нижнему регистру), а сравнение с общим доменом идёт по сырой строке `String(d).replace(/\/$/, '') === 'https://web-sandbox.oaiusercontent.com'` с учётом регистра. spec.md формулирует условие как «Equal to https://web-sandbox.oaiusercontent.com», и семантически речь об origin, а не о строке. Домен в верхнем регистре на практике встречается редко, поэтому severity low.

### R042 [low/bug] APPS-017: `_meta.ui` не-объект (строка, массив) молча превращается в `{}` — нет находки о типе

**Where.** `src/rules/apps.ts:380` (reviewer: limits-apps)

**What.** uiResources делает `r.ui = isObj(r.meta.ui) ? r.meta.ui : {}`, и APPS-017 видит пустой объект: выдаётся только info «prefersBorder is not set», а APPS-005 говорит «no CSP declared», не объясняя, что вся `_meta.ui` некорректного типа. Правило «UI resource meta field types» пропускает самый грубый случай.

**Failure scenario.** Сервер сериализует _meta.ui строкой JSON: отчёт не указывает на корень проблемы.

**Evidence.** r2apps.out, `APPS-017 _meta.ui is a string`: `_meta:{ui:'csp-here'}` → только APPS-005 chatgpt error/claude info и `APPS-017 {spec:info} prefersBorder is not set`.

**Repro (verifier).**

```
17 ui string [{"resource":"ui://w","severity":"info","message":"prefersBorder is not set (explicit value recommended)"}]
17 ui array [{"resource":"ui://w","severity":"info","message":"prefersBorder is not set (explicit value recommended)"}]
```

**Suggested fix.** В APPS-017 проверять `r.meta.ui !== undefined && !isObj(r.meta.ui)` → error «_meta.ui is not an object».

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.75) — uiResources (src/rules/util/ui.ts:50) делает `r.ui = isObj(r.meta.ui) ? r.meta.ui : {}`. APPS-017, судя по названию «UI resource meta field types», проверяет типы полей, но саму `_meta.ui` не-объектного типа не проверяет. Grep по src/rules не находит ни одного правила, которое сообщало бы «_meta.ui is not an object». spec.md перечисляет только проверки отдельных полей, так что это пробел покрытия: отчёт не называет корневую причину, хотя другие находки (APPS-005 no CSP, prefersBorder info) всё равно появятся. Severity low.

### R043 [low/docs-mismatch] APPS-006 выдаёт claude-находку (CDN info), хотя правило, RULES.md и spec.md заявляют только chatgpt/spec

**Where.** `src/rules/apps.ts:144` (reviewer: limits-apps)

**What.** Метаданные APPS-006 (severity = chatgpt/spec) не включают claude, хотя CDN-ветка по замыслу (spec.md §2.7, строка 759) выдаёт claude-находку уровня info. Движок не сверяет platforms находки с ключами severity правила, поэтому каталог (RULES.md:107, --list-rules, explain) и строка severity в spec.md:751 расходятся с фактическим выводом. Исправление: добавить claude: 'info' в severity APPS-006 и перегенерировать каталог.

**Failure scenario.** Пользователь фильтрует или игнорирует правила по каталогу платформ и не ожидает claude-находок от APPS-006.

**Evidence.** apps.ts:121 severity без claude; apps.ts:144 `platforms: ['claude']`; docs/RULES.md:107 `APPS-006 ... chatgpt: warning, spec: warning`.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r043.mjs (APPS_006 из dist/rules/apps.js на snapshot с ui://w, у которого csp.resourceDomains=['https://unpkg.com']) -> keys(severity)=["chatgpt","spec"], check()=[{"resource":"ui://w","platforms":["claude"],"severity":"info","message":"resourceDomains: public CDN unpkg.com; serve from your own origin in production"}]
```

**Suggested fix.** Добавить `claude: 'info'` в severity APPS-006 (каталог и RULES.md перегенерируются) либо вынести CDN-подсказку в отдельное правило.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.85) — Подтверждено. В src/rules/apps.ts:121 у APPS-006 severity = { chatgpt: 'warning', spec: 'warning' }, а CDN-ветка (apps.ts:144) возвращает platforms: ['claude'], severity: 'info'. Движок (src/rules/engine.ts:116-130) берёт r.platforms как есть и не сверяет их с ключами rule.severity, поэтому claude-находка доходит до отчёта: при --target claude правило применимо через 'spec', а при --target all — напрямую. В docs/RULES.md:5 написано, что платформы правила — это ключи severity, и там же в строке 107 Claude для APPS-006 не указан, так что каталог, --list-rules и explain не совпадают с фактическим выводом. spec.md:759 закладывает claude info для CDN, но в строке severity spec.md:751 claude тоже нет, то есть противоречие есть и внутри самого spec.md. Значит, поведение задумано, а метаданные неполные. В известных находках первого раунда этого нет: F106 про APPS-006 касается дублей, это другое. Тестов, которые объясняли бы такое расхождение, нет. Последствия косметические: находка уровня info, на exit code и gating почти не влияет.

### R044 [low/bug] Auth probe разбирает challenge из preflight 403 без WWW-Authenticate и игнорирует настоящий 401 с Bearer-challenge: ложные AUTH-002/004/013

**Where.** `src/connect.ts:319` (reviewer: bearer-preflight-buffers)

**What.** connect.ts:319 действительно выбирает preflight как challengeExchange при любом pf.status 403, даже без WWW-Authenticate, когда trigger = 'bearer-rejected'/'preflight-401' из authFailed. Поэтому настоящий 401 с Bearer resource_metadata из запросов с токеном не разбирается: probe.challenge.status=403 при trigger 'bearer-rejected', PRM из заголовка не пробуется, AUTH-015 пишет «401 has no scope=» про ответ 403. Но AUTH-002/004/013 по сути верны с точки зрения клиента директории. Claude и ChatGPT начинают discovery с неаутентифицированного запроса, получают 403 без challenge, а well-known PRM отдаёт 404, то есть они тоже не найдут OAuth. Сервер нарушает MCP spec (AUTH-003 срабатывает правильно). Неверны внутренняя согласованность probe и формулировки (AUTH-004 пишет «PRM не найден», хотя он есть по ссылке из 401 на токен), а не вердикт. Это редкая конфигурация и в основном вводящая в заблуждение диагностика.

**Failure scenario.** Сервер отвечает 403 без WWW-Authenticate на запрос без токена и 401 с Bearer resource_metadata на просроченный токен; запуск `mcp-review-check <url> --bearer <expired>` выдаёт три error-находки AUTH о том, что OAuth discovery нет, хотя PRM и AS доступны.

**Evidence.** Репро: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/run403.mjs (сервер http403.mjs: без Authorization отдаёт 403 JSON, с любым bearer отдаёт 401 + Bearer resource_metadata=/meta/prm). Вывод (run403.txt):
preflight 403 coverage {"toolLevel":"token-rejected"}
authProbe.trigger bearer-rejected challenge {"status":403,"raw":"","parsed":[]}
real 401 challenge on sdk initialize: ['discover -> Bearer resource_metadata="http://127.0.0.1:44745/meta/prm"']
prm NOT FOUND tried [.../.well-known/oauth-protected-resource/mcp 404, .../.well-known/oauth-protected-resource 404]
error AUTH-002 - 403 has no WWW-Authenticate header
error AUTH-004 - no Protected Resource Metadata found ...
error AUTH-013 - server rejects unauthenticated requests without OAuth discovery ...
info AUTH-015 - 401 has no scope=; ...

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/run403.mjs (сервер http403.mjs: без Authorization отдаёт 403 JSON, с любым Bearer отдаёт 401 + Bearer resource_metadata=/meta/prm). Вывод: authProbe.trigger bearer-rejected challenge {"status":403,"raw":"","parsed":[]}; на discover был реальный 401 с 'Bearer resource_metadata="http://127.0.0.1:44745/meta/prm"'; PRM NOT FOUND (только well-known 404); error AUTH-002/AUTH-004/AUTH-013; info AUTH-015 «401 has no scope=».
```

**Suggested fix.** Брать preflight как challengeExchange только когда trigger начинается с 'preflight-' (401, или 403 с WWW-Authenticate). Для 'bearer-rejected' и для 401 из authFailed брать последний обмен со status 401 (лучше с WWW-Authenticate). AUTH-003 про 403 на неаутентифицированный запрос оставить как есть.

**Verifier votes.**

- *reader*: confirmed (conf 0.7) — Код подтверждён: на строке 286 trigger из preflight ставится только для 401 или для 403 с www-authenticate. При pf=403 без заголовка и authFailed с --bearer trigger становится 'bearer-rejected'. На строке 319 условие `pf.status === 401 || pf.status === 403 ? pf : ...` всё равно берёт pf (403). runAuthProbe (src/probe/auth.ts:66-75) разбирает www-authenticate только из этого exchange, поэтому resource_metadata из настоящего 401 теряется. Готовый репро (/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/run403.txt) это показывает: trigger bearer-rejected, challenge {"status":403,"raw":""}, PRM не найден, хотя discover получил 'Bearer resource_metadata=".../meta/prm"'. Тестов в test/, которые фиксировали бы такое поведение как намеренное, нет. В spec.md про выбор challenge exchange ничего не сказано. Это не дубль первого раунда: F006 про coverage/trigger для --header, F051 про три error на одну причину. Почему severity понижена: Claude и ChatGPT начинают OAuth discovery с запроса без токена. Такой сервер отдаёт им 403 без challenge, а well-known PRM — 404. Значит, вывод «нет OAuth discovery» (AUTH-002/004/013) отражает реальную картину для директории и ложным его назвать нельзя. AUTH-002 «403 has no WWW-Authenticate header» к тому же буквально верен. Реально неверно другое: несогласованный probe.challenge (status 403 при trigger bearer-rejected), подпись AUTH-015 «401» про ответ 403 и формулировка AUTH-004, которая не упоминает PRM, объявленный в 401 на токен. Случай редкий: нужен сервер, который нарушает spec и отдаёт 403 без токена, а 401 с challenge — только на токен.
- *repro*: confirmed (conf 0.85) — Подтверждаю. В src/connect.ts:319 стоит `const challengeExchange = pf.status === 401 || pf.status === 403 ? pf : [...tracer.exchanges].reverse().find((e) => e.status === 401) ?? pf;`. Поэтому preflight с 403 выбирается безусловно, даже без WWW-Authenticate. При этом trigger выставляется в 'preflight-403' только для 403 с WWW-Authenticate (строка 286). Для 403 без заголовка trigger появляется позже из authFailed ('bearer-rejected' или 'preflight-401'), но разбирается всё равно пустой challenge из 403. Настоящий 401 с `Bearer resource_metadata=...` из discover/initialize не используется, так что PRM по заголовку не пробуется. Я перезапустил репро против dist/ (тестовый сервер на 127.0.0.1) и получил ровно то же, что заявлено: challenge.status=403, PRM не найден, хотя он объявлен в 401-challenge, ложные error AUTH-002/004/013 и неверный AUTH-015 «401 has no scope=». Severity оставляю medium. Сценарий узкий: сервер отвечает 403 на запрос без токена, 401 с Bearer-challenge на просроченный токен (типично для API Gateway или WAF перед OAuth), а PRM не лежит по well-known пути. Но там, где он встречается, отчёт ошибочно сообщает, что OAuth discovery нет, хотя это главный вывод отчёта. Если PRM доступен по well-known, AUTH-004/013 частично не сработают, а AUTH-002 и AUTH-015 всё равно разберут не тот ответ. AUTH-003 (403 на неаутентифицированный запрос) правомерен.

### R045 [low/bug] 401 на listing не запускает auth probe: при публичных server/discover или initialize AUTH-правила пропускаются, а 401 превращаются в ложные SPEC-ошибки

**Where.** `src/connect.ts:300` (reviewer: bearer-preflight-buffers)

**What.** Auth probe и coverage 'auth-required' запускаются только по 401 на preflight, SDK-initialize или server/discover (connect.ts:286, 300); так и описано в spec.md §1162. Если сервер пропускает initialize/discover без токена, а на tools/list и остальные методы отвечает HTTP 401 с Bearer-challenge, итог такой: coverage = 'list-failed', все AUTH-правила skipped («server did not request auth»), подсказки --bearer нет. Wire-пробы получают 401 и выдают ложные SPEC-008/SPEC-014 error («got HTTP 401 / code -32001; expected …»), плюс SPEC-020. Конфигурация редкая: auth-middleware обычно стоит перед роутингом, и тогда preflight сам получает 401. Это пробел в замысле, а не отклонение кода от спеки. Исправление: после listEverything проверять HTTP 401 + WWW-Authenticate в ответе на tools/list. Если он есть, выставлять authFailed/coverage как в шаге 4, запускать runAuthProbe с этим exchange как challengeExchange, а wire-пробы пропускать или помечать их 401 как inconclusive.

**Failure scenario.** Modern-only сервер с публичным server/discover и OAuth на всех методах без --bearer: отчёт показывает SPEC-error про коды ошибок и «tools/list failed», AUTH-проверки не выполнены, совета передать --bearer нет.

**Evidence.** Репро: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/modern401.mjs. Вывод (modern401.txt):
preflight 400 era modern coverage {"toolLevel":"list-failed","reason":"tools/list failed: -32001 unauthorized"} authProbe ran: false
AUTH skipped: 19 server did not request auth
error SPEC-008 - unknown method got HTTP 401 / code -32001; expected 404 / -32601
error SPEC-014 - missing Mcp-Method: got HTTP 401 / code -32001; expected 400 / -32020
error SPEC-014 - wrong Mcp-Method: got HTTP 401 / code -32001; expected 400 / -32020
error SPEC-020 - tools/list failed: -32001 unauthorized
(SPEC-007/012 в выводе относятся к упрощённому фейковому серверу и к делу не относятся.)

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/modern401.mjs
preflight 400 era modern coverage {"toolLevel":"list-failed","reason":"tools/list failed: -32001 unauthorized"} authProbe ran: false
AUTH skipped: 19 server did not request auth
error SPEC-008 - unknown method got HTTP 401 / code -32001; expected 404 / -32601
error SPEC-014 - missing Mcp-Method: got HTTP 401 / code -32001; expected 400 / -32020
error SPEC-014 - wrong Mcp-Method: got HTTP 401 / code -32001; expected 400 / -32020
error SPEC-020 - tools/list failed: -32001 unauthorized
```

**Suggested fix.** После listEverything проверять, получил ли tools/list (или первый list) HTTP 401 с WWW-Authenticate. Если да, выставлять authFailed/coverage как в шаге 4 и запускать runAuthProbe с challengeExchange из этого ответа. Wire-пробы при auth-required не запускать или помечать их 401 как inconclusive.

**Verifier votes.**

- *reader*: confirmed (conf 0.7) — Механика подтверждена кодом и запуском репро. В src/connect.ts:286 trigger вычисляется только из preflight (401, или 403 с WWW-Authenticate). В строке 300 authFailed = conn.status===401 || (!conn.ok && !discOk && disc.status===401), то есть смотрит только на initialize/SDK-connect и discover. После listEverything (около строки 330) никто не проверяет HTTP 401 из tools/list, а wire-пробы запускаются безусловно. Новый прогон /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/modern401.mjs дал тот же вывод: era=modern, coverage list-failed, authProbe ran: false, 19 AUTH skipped («server did not request auth»), SPEC-008/SPEC-014 x2/SPEC-020 error с «got HTTP 401 / code -32001». Это не дубль раунда 1: F006 про 401 при --header, F019 про редирект, F121 про legacy discovery. Довод против: поведение совпадает с docs/design/spec.md §1162 («Auth probe runs when the preflight returns 401, … 403 with WWW-Authenticate, or when a --bearer is rejected»), а §384 прямо описывает list-failed при упавшем tools/list. Значит, это пробел в замысле, а не расхождение кода со спекой. Но итог для пользователя всё равно неверный: SPEC-ошибки приписывают серверу неверные коды ошибок, хотя на деле нужен токен, и подсказки --bearer нет. Поэтому не опровергаю. Severity понижаю до low. Триггерная конфигурация редкая: обычно auth-middleware стоит на HTTP-уровне перед JSON-RPC-роутингом, и тогда 401 получают и initialize, и preflight, а этот путь уже обработан. Для modern-сценария нужен порядок «проверка версии раньше auth» плюс публичный discover. Для legacy нужен публичный initialize при HTTP 401 именно на tools/list. Ни одна из этих конфигураций не мейнстрим.
- *repro*: confirmed (conf 0.85) — Подтверждаю по коду и по фактическому запуску. В src/connect.ts (buildHttp) `trigger` берётся только из preflight: 401, либо 403 вместе с WWW-Authenticate. `authFailed` = `conn.status === 401 || (!conn.ok && !discOk && disc.exchange.status === 401)`. В сценарии из утверждения preflight и SDK-initialize получают 400/-32020, а discover отвечает 200. Получается discOk=true, era='modern', authFailed=false, trigger=undefined, поэтому runAuthProbe не вызывается. После этого listEverything, wire-пробы и прочие шаги идут без токена, а их 401 нигде не переводится в auth-required: нет ни проверки после листинга, ни повторного запуска auth probe. В итоге coverage='list-failed', все AUTH-правила пропущены с причиной «server did not request auth», а SPEC-008, SPEC-014 (дважды) и SPEC-020 выдают ложные error из-за 401. Дубликатом первого раунда это не является: F006 про 401 при --header/API-key, F121 про чеклист MAN, ни одна находка из known-round1.json не описывает 401 на этапе листинга. Severity medium оставляю. Результат реально неверный: ложные SPEC-error, нет AUTH-проверок, нет подсказки --bearer. Но конфигурация не самая частая: auth проверяется по методу, а не middleware на весь endpoint, либо проверка версии стоит раньше auth. Legacy-вариант (публичный initialize, tools/list отвечает 401) по коду ведёт к тому же: conn.ok=true, authFailed=false. Его я не запускал отдельно.

### R047 [low/bug] stdio: сообщение больше 10 МБ (лимит SDK ReadBuffer по умолчанию) рвёт соединение, а причина теряется: «Connection closed», ложный APPS-001 и каскад «Not connected»

**Where.** `src/connect.ts:423` (reviewer: bearer-preflight-buffers)

**What.** GroupStdioTransport создаётся без maxBufferSize, поэтому действует STDIO_DEFAULT_MAX_BUFFER_SIZE = 10 МБ из SDK (shared/stdio.js:2). Для HTTP линтер принимает до 64 МБ (FULL_READ_CAP), а у SDK-пути лимита нет совсем. Ответ tools/list или resources/read больше 10 МБ на stdio вызывает исключение ReadBuffer, транспорт закрывается и сервер убивается. Текст «ReadBuffer exceeded maximum size of 10485760 bytes» попадает только в rec.transportErrors, который никто не читает, а пользователь видит «MCP error -32000: Connection closed». Последствия: APPS-001 error «resources/read failed for the UI resource», coverage list-failed и SPEC-020, все wire-пробы получают «Not connected», toolsRelist молча пропадает. Обработчик 'data' не снимается после close, поэтому переполнение срабатывает повторно (наблюдалось 4 вызова close()). На вопрос о строке больше 512 МБ (MAX_STRING_LENGTH): этот случай недостижим, потому что SDK обрывает приём на 10 МБ раньше, а наш tap-буфер до закрытия процесса растёт ограниченно по времени (см. переоценку F141).

**Failure scenario.** stdio MCP-App сервер отдаёт UI-ресурс с инлайновыми ассетами на 11 МБ: отчёт выдаёт APPS-001 error «resources/read failed», wire-пробы и re-list не выполнены, а реальная причина (лимит буфера клиента) нигде не названа.

**Evidence.** Репро rules.mjs bigui 11 (UI-ресурс 11 МБ), вывод bigui11.txt:
resourceReads {"ui://widget/main.html":{"ok":false,"error":"MCP error -32000: Connection closed"}}
probes {"unknownMethod":"Error: Not connected","unknownTool":"Error: Not connected","resourceMissing":"Error: Not connected"}
relist undefined
error APPS-001 - resources/read failed for the UI resource
run.mjs bigjson 12 (bigjson12.txt): coverage list-failed «tools/list failed: MCP error -32000: Connection closed»
Счётчик в инструментированной копии dist (run-count.mjs, count-noline.txt): closes 4, transportErrors {"ReadBuffer exceeded maximum size of 10485760 bytes": 4}, fatal «Connection closed».
Все файлы лежат в /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/

**Repro (verifier).**

```
/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/bigui11.txt: resourceReads {"ui://widget/main.html":{"ok":false,"error":"MCP error -32000: Connection closed"}}; probes {..."Error: Not connected"}; relist undefined; error APPS-001. /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/count-noline.txt: closes 4, counts {"ReadBuffer exceeded maximum size of 10485760 bytes": 4}, fatal "...Connection closed". SDK: node_modules/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js:2 STDIO_DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024.
```

**Suggested fix.** Передавать maxBufferSize (например FULL_READ_CAP) в параметры StdioClientTransport, чтобы лимит совпадал с HTTP. Последнюю transportError с «ReadBuffer exceeded» добавлять к fatal, listMeta.error и resourceReads.error («server message exceeded 10 MB stdio buffer»). Снимать stdout-listener после первого переполнения.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.8) — Подтверждено по коду. src/connect.ts:423 создаёт GroupStdioTransport без maxBufferSize. Конструктор SDK (client/stdio.js:52) передаёт server.maxBufferSize в ReadBuffer, а shared/stdio.js:2 задаёт значение по умолчанию STDIO_DEFAULT_MAX_BUFFER_SIZE = 10*1024*1024. При превышении ReadBuffer.append бросает «ReadBuffer exceeded maximum size of 10485760 bytes». Переопределённый start() (connect.ts:630) ловит это исключение, вызывает onerror и close(), но 'data'-listener не снимает, поэтому close повторяется на каждом следующем чанке. Текст ошибки уходит только в RecordingTransport.transportErrors. Что их никто не читает, отмечено в F033 как общий факт. Последствие именно для stdio-лимита, то есть потерянная причина, ложный APPS-001 и каскад «Not connected», в раунде 1 не описано. F141 упоминает 10 МБ только как ограничение для tap-буфера. Ни в fatal, ни в listMeta.error, ни в resourceReads.error текст ReadBuffer не попадает: buildStdio (465-471) берёт только e.message, а это «Connection closed». Тестов, которые показывали бы, что такое поведение задумано, нет: grep по test/ на ReadBuffer/maxBuffer пуст. spec.md об stdio-лимите буфера ничего не говорит. Repro в scratchpad согласуется с кодом: bigui11.txt — resourceReads error «MCP error -32000: Connection closed», probes «Not connected», relist undefined, APPS-001 error; count-noline.txt — closes 4, transportErrors {ReadBuffer exceeded…: 4}. Severity оставляю low: ответ на stdio больше 10 МБ встречается редко, хотя диагноз в отчёте выходит неверный (APPS-001 вместо «превышен лимит клиента»).

### R048 [low/bug] Неудачный stdio-initialize выбрасывает собранный не-JSON stdout: SRV-018 молчит, а диагноз сводится к «Request timed out»

**Where.** `src/connect.ts:468` (reviewer: bearer-preflight-buffers)

**What.** При ошибке connectStdio массив nonJson теряется: в исключение попадает только stderrTail, а buildStdio в catch не заполняет snap.transport.stdio. Типичная ошибка пользователя — запуск HTTP-сервера или CLI, который печатает баннер в stdout, через --stdio. Такой процесс выводит, например, «MCP server listening on http://localhost:3000/mcp» и не отвечает. Через полный --timeout отчёт показывает только «MCP error -32001: Request timed out». SRV-018 не срабатывает, хотя stdout содержит именно ту строку, которая объясняет проблему.

**Failure scenario.** `mcp-review-check --stdio "node http-server.js"` у сервера, который пишет в stdout «listening on http://localhost:3000»: через 30 с пользователь получает «Request timed out» без подсказки, а SRV-018 не сообщает о мусоре в stdout.

**Evidence.** Репро run-httpish.mjs (сервер httpish.mjs: console.log баннера и бесконечное ожидание), вывод httpish.txt:
fatal: could not start or initialize the stdio server: MCP error -32001: Request timed out
transport.stdio: undefined stderrTail: ""
SRV-018 finding: []
error SRV-003 - stdio server did not start: ... Request timed out
Файлы: /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/

**Repro (verifier).**

```
/tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/httpish.mjs (console.log('MCP server listening on http://localhost:3000/mcp') + setInterval) -> /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r2/httpish.txt: fatal: could not start or initialize the stdio server: MCP error -32001: Request timed out; transport.stdio: undefined stderrTail: ""; SRV-018 finding: []; error SRV-003 - stdio server did not start: ... Request timed out
```

**Suggested fix.** Прикреплять nonJson к ошибке connectStdio, как stderrTail, и в catch buildStdio записывать snap.transport.stdio = { nonJsonStdout, stderrTail }. В fatal добавлять первую не-JSON строку stdout (после scrub, до 200 символов). Если строка похожа на «listening on http…», подсказывать запуск по URL.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.85) — Подтверждено. Если initialize падает, connectStdio (connect.ts:450-455) прикрепляет к ошибке только stderrTail, локальный массив nonJson теряется. В catch функции buildStdio (468-471) заполняются только fatal и coverage, а snap.transport.stdio не записывается. Записывается он только в строке 510, на успешном пути. Запасной путь stoppedSnapshot (656) работает только тогда, когда progress.nonJsonStdout уже присвоен. Это происходит в строке 475, после успешного connect, и лишь при остановке по --max-duration. Значит, при обычном таймауте initialize SRV-018 (rules/server.ts:454) видит пустой список и молчит. SRV-003 (server.ts:74-76) выводит fatal и советует смотреть stderr, но stderr пустой. В раунде 1 найдены F012, F141 и F146 про неограниченный рост nonJson, но не про его потерю при неудачном старте. Тестов на этот случай нет. Утверждение не противоречит spec.md (SRV-018 должен сообщать о не-JSON в stdout). Repro httpish.txt совпадает с кодом. Severity low: проблема только в диагностике, итоговая ошибка SRV-003 и так есть, но без подсказки о причине и только после полного --timeout.

## 2. Disputed (verifiers disagree; maintainer decides)

| ID | Sev | Kind | File | Title |
|---|---|---|---|---|
| R014 | low | docs-mismatch | `src/report/index.ts:133` | summary.errors/warnings считаются по максимальной severity с учётом spec и не совпадают ни с вердиктами, ни с gate |
| R029 | low | bug | `src/rules/apps.ts:60` | APPS-003: MIME с дополнительными параметрами (`;charset=utf-8`) или с другим порядком параметров — error на всех платформах |
| R031 | low | bug | `src/rules/util/ui.ts:171` | cspOf сливает openai/widgetCSP с ui.csp для всех платформ: Claude-находки APPS-005/007 пропадают, а APPS-008/005 дают Claude-находки по OpenAI-ключам |

### R014 [low/docs-mismatch] summary.errors/warnings считаются по максимальной severity с учётом spec и не совпадают ни с вердиктами, ни с gate

**Where.** `src/report/index.ts:133` (reviewer: score-gate-github-explain)

**What.** src/report/index.ts:53-55: summary.errors/warnings/info считаются по f.severity. Это максимум по активным платформам --target, куда всегда входит spec, и считается он независимо от --fail-on-spec. Вердикты (summary.verdicts.*) и gate используют severity конкретной платформы. Пример: находка с claude=warning и spec=error при --target claude даёт summary.errors=1 и строку «1 errors», хотя verdicts.claude.errors=0 и failed=false. Счётчики совпадают с разделами ERRORS/WARNINGS текстового отчёта, а notGated объясняет расхождение. Но ни README, ни JSON-схема не говорят, что эти поля учитывают spec без gating и что решение о провале — summary.failed/summary.gate. Поэтому CI, который проверяет `.summary.errors > 0`, разойдётся с exit code. Исправление: задокументировать семантику или добавить отдельные счётчики по gated-платформам.

**Failure scenario.** CI-скрипт с `jq '.summary.errors > 0'` валит сборку по spec-ошибке, хотя CLI вернул 0 и README говорит, что spec без --fail-on-spec не валит.

**Evidence.** gate.out, случай 1: `PASS (--fail-on error) · spec: 1 error (X-1) not gated ... { e: 1, w: 0, i: 0, failed: false } {"claude":{"verdict":"NEEDS ATTENTION","errors":0,"warnings":1}}`. Случай 7 (spec-only override severity error): e:1, verdict claude NO AUTOMATED BLOCKERS, PASS. Код: index.ts:133-135 `errors: f.filter((x) => x.severity === 'error').length`.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r014.mjs (buildReport из dist, target=claude, находка severityByPlatform {claude:'warning', spec:'error'}) -> {"e":1,"w":0,"failed":false,"v":{"claude":{"verdict":"NEEDS ATTENTION","errors":0,"warnings":1}},"notGated":"spec: 1 error (X-1) not gated; add --fail-on-spec to fail on spec findings"}
```

**Suggested fix.** Либо добавить в summary счётчики по gated-платформам (например `summary.gated: {errors, warnings}`), либо задокументировать в README/JSON-схеме, что errors/warnings — это максимум по --target-директориям и spec без учёта gating, и что решение о провале — summary.failed/summary.gate.

**Verifier votes.**

- *reader-batch*: confirmed (conf 0.55) — Строка устарела: подсчёт находится в src/report/index.ts:53-55 (buildReport), а не на :133. Само поведение подтверждается. В engine.ts:120/130 f.severity — это maxSeverity по платформам из activePlatforms(target), а туда всегда входит 'spec' (engine.ts:7-9). При этом gate() и verdict() берут platformSeverity по каждой платформе отдельно, а spec попадает в gate только с --fail-on-spec. Есть смягчающие обстоятельства. Счётчики совпадают с тем, как находки показываются в списке ERRORS/WARNINGS (заголовок раздела строится по той же f.severity, spec-находки в списке есть). Строка Result и summary.gate.notGated прямо пишут, что spec не учитывается в gate. Для решения о провале в JSON есть summary.failed. Тестов, которые закрепляли бы или опровергали это поведение, в test/ нет (root-causes.test и e2e-redaction проверяют только, что число есть и совпадает с текстом). README:158 («listed findings ... follow --target») и README:107 не говорят, по какой severity считаются summary.errors/warnings, и формально перечисленные находки действительно следуют --target (claude+spec). Поэтому это пробел в документации и неочевидная семантика, а не неверный gate. Подтверждаю с severity low.

### R029 [low/bug] APPS-003: MIME с дополнительными параметрами (`;charset=utf-8`) или с другим порядком параметров — error на всех платформах

**Where.** `src/rules/apps.ts:60` (reviewer: limits-apps)

**What.** Механика подтверждена. normalizeMime (src/rules/apps.ts:60) только приводит к нижнему регистру тип и ключи параметров и убирает пробелы, а дальше сравнивает строку целиком с RESOURCE_MIME_TYPE. Поэтому `text/html;profile=mcp-app;charset=utf-8` и `text/html; charset=utf-8; profile=mcp-app` дают APPS-003 error на spec/claude/chatgpt. Но так задумано: docs/design/spec.md:736 прямо требует точного совпадения после нормализации. Неверно это только для варианта с другим порядком параметров (по RFC 2045 он эквивалентен), и то лишь для платформы spec. Утверждение, что хосты Claude и ChatGPT принимают лишние параметры вроде charset, не проверено. Если хосты сравнивают строку целиком, error на claude/chatgpt верен и полезен. Довод «фреймворки сами добавляют charset» к MCP не относится: mimeType ресурса задаёт код сервера, а не HTTP-заголовок. Severity понижена до low: это редкий случай, и его правильность для хостов спорна. Возможное исправление: парсить параметры без учёта порядка, а для лишних параметров на claude/chatgpt выдавать warning, а не error.

**Failure scenario.** Сервер отдаёт mimeType `text/html;profile=mcp-app;charset=utf-8`: три error-находки, хотя хосты различают профиль по параметру profile.

**Evidence.** r2apps.out: `mime text/html;profile=mcp-app;charset=utf-8` → `APPS-003 {spec:error, claude:error, chatgpt:error} mimeType is ... expected text/html;profile=mcp-app`; так же для `text/html; charset=utf-8; profile=mcp-app`.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r029.mjs
"text/html;profile=mcp-app" -> "text/html;profile=mcp-app" true
"text/html;profile=mcp-app;charset=utf-8" -> "text/html;profile=mcp-app;charset=utf-8" false
"text/html; charset=utf-8; profile=mcp-app" -> "text/html;charset=utf-8;profile=mcp-app" false
"Text/HTML; Profile=mcp-app" -> "text/html;profile=mcp-app" true
(APPS-003 добавляет error, когда normalizeMime(mt) !== RESOURCE_MIME_TYPE, src/rules/apps.ts:76)
```

**Suggested fix.** Парсить MIME в type/subtype + Map параметров и проверять `type==='text/html' && params.get('profile')==='mcp-app'`. Лишние параметры — максимум info.

**Verifier votes.**

- *reader*: REFUTED (conf 0.65) — Механика описана верно: я прогнал normalizeMime из dist и получил `text/html;profile=mcp-app;charset=utf-8` и `text/html;charset=utf-8;profile=mcp-app`. Обе строки не равны RESOURCE_MIME_TYPE (`text/html;profile=mcp-app`, src/rules/util/ui.ts:5), поэтому APPS-003 срабатывает. Но поведение задано замыслом, и это не баг. В docs/design/spec.md:736 правило определено так: «mimeType, after lowercasing type and subtype and stripping whitespace around `;`, is not `text/html;profile=mcp-app`». Значит, по замыслу сравнивается вся строка после нормализации регистра и пробелов, без разбора параметров и без допуска лишних. Тест test/rules/apps.test.ts:37 и :138 проверяет именно эту нормализацию: пробелы и регистр допускаются, больше ничего. Главный довод находки, «хосты различают профиль по параметру profile», не подтверждён. Спецификация ext-apps требует mimeType ровно `text/html;profile=mcp-app`. Эталонные хост-реализации ext-apps, насколько мне известно, сравнивают строгим равенством с RESOURCE_MIME_TYPE. Это я не проверял: исходников ext-apps на машине нет. Если так, сервер с `;charset=utf-8` реально не отрисуется, и error верен: инструмент и так мягче хоста, потому что прощает пробелы и регистр. Пометить лишние параметры как info, как предлагает автор, означало бы рискнуть пропустить реальный отказ рендера. Довод про RFC 2045 справедлив для MIME вообще, но хосты MCP Apps сравнивают строку, а не разбирают её по RFC. Это в лучшем случае предложение изменить spec, а не ошибка кода. Повтором находки F107 (кавычки) это не является. Repro: normalizeMime('text/html;profile=mcp-app;charset=utf-8') -> 'text/html;profile=mcp-app;charset=utf-8'; normalizeMime('text/html; charset=utf-8; profile=mcp-app') -> 'text/html;charset=utf-8;profile=mcp-app'; normalizeMime('Text/HTML ; profile=mcp-app') -> 'text/html;profile=mcp-app'.
- *repro*: confirmed (conf 0.55) — Воспроизвёл normalizeMime на dist/rules/apps.js: варианты с charset и с другим порядком параметров не равны ожидаемому значению, поэтому APPS-003 выдаёт error. Поведение совпадает с проектным spec.md:736 (точное совпадение после нормализации), то есть это не баг реализации, а спорное проектное решение. Что делают реальные хосты, проверить не могу: в node_modules нет host-кода, сеть не использовал. Если хосты сравнивают строку точно, error для claude/chatgpt правилен. С F107 (кавычки) находка не пересекается. Подтверждаю с low severity, потому что спецификация считает порядок параметров незначимым, а на этих входах правило ставит error всем платформам.

### R031 [low/bug] cspOf сливает openai/widgetCSP с ui.csp для всех платформ: Claude-находки APPS-005/007 пропадают, а APPS-008/005 дают Claude-находки по OpenAI-ключам

**Where.** `src/rules/util/ui.ts:171` (reviewer: limits-apps)

**What.** cspOf (src/rules/util/ui.ts:76, а не :171) без учёта платформы складывает `_meta.ui.csp` и `openai/widgetCSP` в один view. Его используют APPS-005, 006, 007, 008 и 012, причём в каждом правиле на всех платформах. В итоге для Claude поля только из openai/widgetCSP считаются объявленными. При этом нет доказательств, что Claude читает openai/* (в документации Claude и в ext-apps spec описан только `_meta.ui.csp`). Последствия: APPS-005 не выдаёт claude info, APPS-007 не предупреждает Claude о недекларированных origin, APPS-008 выдаёт claude-находку «frameDomains declared» по полю frame_domains. Это поведение совпадает с docs/design/spec.md §APPS-005: там оба ключа считаются альтернативами, а malformed-поле даёт error на всех платформах. Значит, это не ошибка реализации, а спорное проектное решение. Влияет только на ChatGPT-first серверы при `--target claude`/`all`. С находками раунда 1 не пересекается: F106 про дубли в APPS-006, F100 про потерю list-entry _meta.

**Failure scenario.** ChatGPT-first сервер объявляет только openai/widgetCSP: `--target claude` показывает чистый APPS-007, а в Claude виджет не может загрузить API и скрипты.

**Evidence.** r2apps.out: `only openai/widgetCSP` → APPS-005 и APPS-007 не выдают ни одной claude-находки; `APPS-008 {"claude":"warning"} frameDomains declared (https://embed.example.com)`; `malformed openai/widgetCSP` → `APPS-005 {"chatgpt":"error","claude":"error"} CSP fields are not string[]: openai/widgetCSP.connect_domains`.

**Repro (verifier).**

```
node /tmp/claude-1000/-home-kali-packages/fae74d01-791a-469a-ab5f-90cdb063ebe5/scratchpad/r031.mjs (cspOf из dist/rules/util/ui.js):
only oai {"declared":true,"connect":["https://api.x.com"],"frame":["https://embed.example.com"],"malformed":[]}
malformed oai {"declared":true,"connect":[],"frame":[],"malformed":["openai/widgetCSP.connect_domains"]}
Для всех платформ используется один view (apps.ts:105,129,166,189). Malformed выдаётся с severity:'error' без platforms (apps.ts:111), поэтому claude=error.
```

**Suggested fix.** Строить два view: mcpCsp (только ui.csp) для claude/spec и mergedCsp для chatgpt. В APPS-005/007/008 выдавать платформенные находки по соответствующему view; malformed openai/* — с platforms:['chatgpt'].

**Verifier votes.**

- *reader*: REFUTED (conf 0.75) — Утверждение опровергается: код явно соответствует проектной спецификации docs/design/spec.md. (1) Ссылка устарела: в src/rules/util/ui.ts всего 93 строки, а cspOf находится в строках 76-93, а не на строке 171. (2) В spec.md:746 для APPS-005 написано: «Detect: both `_meta.ui.csp` and the legacy `_meta["openai/widgetCSP"]` are absent». Значит, openai/widgetCSP задумано как legacy-алиас CSP, и Claude-info выдаётся, только если отсутствуют оба поля. Там же сказано: «A declared CSP field that is not a string[] → **error** on all platforms». Поэтому claude=error для некорректного openai/widgetCSP.connect_domains получается намеренно. (3) Для APPS-007 спецификация требует сверять origin с объединёнными списками `resourceDomains`/`resource_domains`, `connectDomains`/`connect_domains`, `frameDomains`/`frame_domains` без разделения по платформам. (4) Для APPS-008 условие такое: «`frameDomains` or `frame_domains` is non-empty». Claude-находка выдаётся при любом из двух полей. Код apps.ts:105-111, 166-176, 189-191 повторяет это дословно. Автор находки сам признаёт, что не знает, игнорирует ли Claude openai/widgetCSP, и проектных доказательств тоже не приводит. Получается разногласие с намеренным проектным решением, а не дефект реализации. Его можно поднять как вопрос к спецификации (стоит ли считать openai/widgetCSP алиасом для Claude), но как bug в коде он не подтверждается. Повторных прогонов я не делал: вывод r2apps.out, который приводит автор, согласуется с кодом, а спорна именно интерпретация.
- *repro*: confirmed (conf 0.5) — Поведение воспроизведено против dist: если задан только openai/widgetCSP, cspOf возвращает declared=true и заполняет connect/frame, а malformed openai-поле попадает в общий malformed. В APPS-005 malformed выдаётся с severity 'error' без platforms, поэтому claude тоже получает error. APPS-007 и APPS-008 используют один и тот же объединённый view для всех платформ. Но так задумано: docs/design/spec.md:746 называет widgetCSP «legacy» альтернативой, при отсутствии которой срабатывает APPS-005, и требует error на всех платформах для malformed. Утверждение держится на том, что Claude игнорирует openai/widgetCSP. Это правдоподобно, потому что Claude документирует только `_meta.ui.csp`, но в проекте это не проверено и офлайн не проверяется. Отсюда confidence 0.5. Серьёзность снижена до low: затронут только край ChatGPT-only CSP при проверке под Claude, основной сценарий не ломается. Строка в утверждении указана неверно: cspOf находится на строке 76, а не 171.

## 3. Refuted (kept so they are not re-reported)

| ID | File | Original title | Why refuted |
|---|---|---|---|
| C004 | `src/connect.ts` | --stdio "npx …" и .cmd/.bat на Windows не запускаются: spawn с shell:false не находит npx (ENOENT) и отказывается от .cmd (EINVAL) | Опровергнуть не удалось. На win32 GroupStdioTransport.start() (src/connect.ts:620) возвращает super.start(). Это SDK StdioClientTransport.start (node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js:64-73), который вызывает spawn(command, args, { shell: false, windowsHide: true }). Выше по / Утверждение опирается на неверное допущение. SDK StdioClientTransport в node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js:1 импортирует `spawn` из `cross-spawn` (7.0.6), а не из node:child_process. Опция `shell:false` у cross-spawn не отключает обработку для Windows: на win32 parseNonS / Решающее расхождение между голосами одно: какой spawn вызывает SDK на win32. Ответ — cross-spawn, а не node:child_process.  Факты из кода: 1) src/connect.ts:620: `if (process.platform === 'win32') return super.start();`. На Windows запуск полностью уходит в SDK StdioClientTransport.start(). Собствен |
| F007 | `src/connect.ts` | Любой TypeError при SDK-коннекте ретраится как сетевой сбой | Строка актуальна (connect.ts:210), и любой TypeError на первой попытке действительно повторяется один раз. Но заявленный вред не подтверждается. (1) Для ошибок валидации (невалидное имя заголовка, URL с userinfo) undici бросает TypeError ещё до отправки запроса, поэтому повтор не удваивает ни время, |
| F014 | `docs/design/spec.md` | Спека расходится с кодом: токенайзер --stdio, тип coverage.toolLevel, поля options | Факты верны: spec.md:1143 пишет про backslash escapes, а в spec.md:1273 нет 'list-failed'\|'stopped' и `authenticated`, хотя в src/snapshot.ts:175,181 они есть. Но это не дефект. Шапка spec.md (строки 3-13) прямо называет документ «Design document; it may differ from the implementation», говорит, чт |
| F022 | `src/protocol/trace.ts` | Set-Cookie ответов не редактируется по имени (и несколько Set-Cookie схлопываются до последнего) | Наблюдения из кода верны: в src/protocol/trace.ts:25 `headerNames` = {authorization, cookie, proxy-authorization, --header}, `set-cookie` туда не входит; `headersToRecord` (строка 53) оставляет последний `set-cookie`. Но заявленного последствия (утечка секрета или неверный результат) нет — заголовки / Механика воспроизводится, но реального дефекта нет: значение Set-Cookie никуда не выводится, ни одно правило его не читает, а спецификация не требует его маскировать.  1) Механика подтверждена. `headersToRecord` (trace.ts:53) пишет `out[k.toLowerCase()] = String(v)`. `Headers.entries()` в Node отдаё |
| F026 | `src/probe/auth.ts` | Auth-discovery и --active-auth ходят по URL, продиктованным сервером, без ограничений схемы/адреса (SSRF-подобное поведение инструмента) | Фактическая часть верна. В src/probe/auth.ts:76 кандидаты PRM берутся из resource_metadata, на :107 идёт GET по каждому issuer, на :158, :182 и :189 делаются запросы DCR, authorize и token, и всё это без проверки protocol или isNonPublicIp. Но поведение намеренное и задокументировано. В SECURITY.md, |
| F044 | `src/rules/server.ts` | SRV-009: любой 403/429 за Cloudflare с не-JSON телом помечается как WAF/bot-challenge | Утверждение опровергнуто. Описанное поведение есть в коде, но оно намеренное и прямо прописано в спецификации, поэтому дефектом не является.  1. Строка актуальна. В src/rules/server.ts на строке 234 стоит условие `(e.status === 403 \|\| e.status === 429) && /cloudflare\|akamai/i.test(e.headers?.serv / Механически поведение воспроизводится: SRV-009 срабатывает на обычный 429 (text/plain, Retry-After) и на 403 text/html от origin, если в ответе есть `server: cloudflare`. Но это не расхождение кода с замыслом, а точная реализация спецификации. В docs/design/spec.md:185-190 для SRV-009 прямо записан  |
| F046 | `src/rules/spec.ts` | SPEC-013: невалидный cacheScope на одной странице дополнительно даёт ложное «cacheScope differs between pages» | Механика описана верно: в src/rules/spec.ts:301 (строка актуальна) `(scopes[method] ??= new Set()).add(result.cacheScope)` добавляет в Set любое значение, в том числе невалидное. Поэтому для страниц 'public' и 'PUBLIC' правило выдаёт два error. Но ложным второй финдинг назвать нельзя. Значения cache |
| F047 | `src/rules/server.ts` | SRV-012: пустая строка в serverInfo.title не даёт fallback на name | Строка 296 актуальна, и репро подтверждается: при serverInfo={name:'weather',title:'',version:'1'} SRV_012 возвращает [], а без title выдаёт находку. Но поведение в точности совпадает с замыслом: docs/design/spec.md:210 задаёт Detect как `serverInfo.title ?? name`, то есть код реализует спеку буквал |
| F048 | `src/rules/server.ts` | SRV-017: IDN-хост и пробелы/percent-encoding в пути дают ложное «Entered URL differs from canonical» | Репро воспроизводится: строки 437-440 (а не 439) для `https://пример.рф/mcp` дают info «differs from canonical https://xn--e1afmkfd.xn--p1ai/mcp», для `/my mcp` дают `/my%20mcp`. Однако сообщение по существу верно, а не ложно. Canonical server URI в MCP spec и RFC 8707/9728 — это URI по RFC 3986, гд |
| F072 | `src/rules/tools.ts` | Непоследовательный подсчёт длины строк: TOOL-001 и TOOL-029 считают UTF-16-единицы, TOOL-002/006 — code points | Сама непоследовательность в коде есть: :39 считает name.length (UTF-16), :50 считает `[...name].length`, :414 считает v.length. Но доказанного дефекта нет. (1) TOOL-001: регулярное выражение пропускает только ASCII, а у любого имени из допустимых символов длина в UTF-16 и в code points совпадает. Ес |
| F075 | `docs/design/spec.md` | spec.md расходится с кодом по TOOL-007 (claude=warning vs error), TOOL-012 (per-hint vs per-tool), TOOL-027 (списки токенов/LIMIT_PROP) | Строка 422 актуальна: там TOOL-007 claude=warning. Но шапка spec.md:11 прямо говорит: «several severities changed (for example TOOL-007 ...)» и называет каталог в src/rules/ авторитетным для severity. Остальные пункты тоже описаны в CHANGELOG.md, на который ссылается шапка: TOOL-007 claude=error — C |
| F100 | `src/rules/util/ui.ts` | uiResources: _meta берётся целиком либо из read-item, либо из list-entry — CSP на list-entry теряется, если у item есть любая своя _meta | Сама механика описана верно и воспроизводится. В src/rules/util/ui.ts:49 (строка актуальна) `r.meta` целиком берётся из `_meta` read-item, если там есть хоть один ключ. CSP, объявленный только в list-entry, при этом теряется, и APPS-005 выдаёт chatgpt/claude «no CSP declared». Но это поведение по за |
| F112 | `docs/design/spec.md` | spec.md отстаёт от кода: INJ-006 (conditional/info-ветка), INJ-008 (доп. альтернативы), INJ-004 (JSON-курсор), APPS-014 (ui/initialize), APPS-019 отсутствует в §2.7 | Строка 614 указывает на абзац INJ-001 (regex ignore previous instructions), а не на INJ-006/INJ-008/APPS-014. Утверждение, что APPS-019 есть только в строке 8, по сути подтверждает, что шапка расхождение признаёт: «the catalog has 144 automated rules (APPS-019 added)». Остальные пункты описаны в CHA |
| F120 | `src/protocol/trace.ts` | Set-Cookie ответа сервера записывается в отчёт в открытом виде | Сама предпосылка верна: в headerNames (строка 25) нет set-cookie, и в tracer.exchanges[].headers значение хранится открытым. Но заявленное последствие «далее в JSON/SARIF-отчёт» не подтверждается. src/report/json.ts берёт из snap.transport только `kind` (строка 27), exchanges не сериализует. markdow |
| F126 | `src/report/markdown.ts` | Zero-width space внутри URL/URI в markdown ломает копирование Target и resource-URI | Поведение описано верно (src/report/markdown.ts:19, text() ставит U+200B в '://' и 'www.'; применяется к Target в строке 43 и к Subject в строке 62), но оно намеренное и закреплено. 1) В doc-комментарии на строках 17-18 прямо сказано: «one inside "://" and "www." keeps GFM from linking a bare URL».  |
| F130 | `docs/design/spec.md` | Спека: схлопывание «более 3 находок» и SARIF artifactLocation = URL сервера — код делает иначе | Строки 1394 и 1424 актуальны, текст совпадает с цитатами. Но все три пункта задокументированы. Подсчёт root causes и scoreVersion 2 прямо названы в шапке spec.md:11. Схлопывание «from two up (it was from four)» описано в CHANGELOG.md:84 вместе с заменой формулы с cap 3. SARIF artifactLocation = `.mc |
| F140 | `src/probe/auth.ts` | SSRF/оракул портов через URL из WWW-Authenticate и OAuth-метаданных: нет фильтра схем и приватных адресов (data:, 169.254.*, 10.*) | Описанное поведение есть в коде, но это задокументированное проектное решение, а не дефект корректности. 1) SECURITY.md:27 прямо пишет, что OAuth-проба ходит по URL, которые объявил сервер («following the URLs the server advertises»: resource_metadata, authorization_servers, до 3 AS), а также резолв / Механика воспроизводится: URL-ы из WWW-Authenticate и PRM/AS-метаданных используются без фильтра схем и адресов. Но это не дефект, а задокументированное проектное решение, и реальный эффект ограничен. 1) SECURITY.md, раздел «Threat model and safe use»: «The OAuth probe follows URLs chosen by the ser |
| F142 | `src/protocol/trace.ts` | Квадратичный sseResponseWatcher: SSE-тело без пустых строк пересканируется целиком на каждом чанке | Квадратичность есть: на каждом чанке делается buf.split по всему буферу, если в теле нет разделителя событий. Строки сейчас 78-86, а не 366 — номер устарел. Однако чтение ограничено timeoutMs (fullBody: оставшийся бюджет запроса, по умолчанию 30 с; SDK/пробы: 10 с и cap 256 KB, где квадратичность ни |
| F143 | `src/rules/server.ts` | SRV-006 печатает Location редиректа без редакции; set-cookie/location в записанных заголовках не маскируются | Строки 166-167 актуальны, и в сообщении действительно печатается `target.href` без displayUrl. Репро с Location `https://other.host/cb?access_token=...` выводит токен как есть. Но спека §4.5 (spec.md:1354-1355) ограничивает редакцию значениями Authorization, Cookie, --header и query, совпавшими с AU |
| F154 | `docs/design/spec.md` | spec.md: несовпадения с кодом, не перечисленные в его собственном списке «Known differences» | В главном утверждение неверно: список «Known differences» не претендует на полноту. Шапка spec.md (строки 3-13) прямо говорит «Design document; it may differ from the implementation», перечисляет опции через «such as» и заканчивается фразой «See CHANGELOG.md for the full list». Разбор по пунктам. (1 |
| F157 | `test/local-mode.test.ts` | Top-level await dns.lookup(os.hostname()) при импорте тест-файла зависит от системного резолвера (потенциально медленно/флаки в CI) | Строка актуальна: test/local-mode.test.ts:40 действительно на уровне модуля делает `await lookup(hostname(), {family:4})`, а :60 — `it.skipIf(!shortNameAddress)`. Но заявленный дефект (медленно и нестабильно в CI) не подтверждается. 1) Поведение намеренное: тест проверяет автоматический local mode д |
| F162 | `src/cli.ts` | --timeout/--max-duration принимают hex/экспоненту/пробелы через Number() | Строки src/cli.ts:227-228 и 233-234 актуальны, и поведение воспроизводится: `Number()` принимает `0x10`, `1e3`, ` 500 `, `0b11`, причём и для --timeout, и для --max-duration. Но это не дефект. Значение разбирается однозначно и так, как его понимает JavaScript: `0x10` действительно 16 ms. Текст ошибк |
| F163 | `src/cli.ts` | Сообщение об ошибке --list-rules --format перечисляет text/json/markdown, хотя sarif принимается | Строка 201 актуальна, расхождение воспроизводится: `--list-rules --format yaml` даёт «must be text, json or markdown», а `--format sarif` принимается с exit 0. Но так сделано намеренно. Комментарий на строке 202 и тест test/cli-rules.test.ts:82-86 объясняют, что у SARIF нет формы каталога, и sarif п |
| F167 | `README.md` | Непоследовательное название второй директории: «ChatGPT plugin directory» vs «ChatGPT Apps / plugin directory» | Проект последовательно использует «ChatGPT plugin directory»: README.md:3, package.json description, src/cli.ts:26 (--help), docs/design/spec.md:17 и :30 («chatgpt (OpenAI plugin directory)»). Это соответствует официальным источникам, на которые ссылаются правила: все ссылки OpenAI в src ведут на de |
| R017 | `src/cli.ts` | --list-rules с префиксом не в форме ID (TOOL_, tool 0, TOOL-0*) молча печатает весь каталог с exit 0, а TOOLS даёт exit 2 | Поведение воспроизводится (`--list-rules TOOL_` даёт весь каталог и exit 0, `TOOLS` даёт exit 2), но оно намеренное и задокументировано в коде. Комментарий в cli.ts:196 говорит, что фильтрует только префикс в форме ID, а всё остальное (URL с токеном, путь) выводит весь каталог «as the baseline did,  |
| R039 | `src/rules/apps.ts` | APPS-019 молчит, когда сервер отказывает text-only клиенту целиком (initialize или tools/list падает без UI-расширения) | Молчание при сбое сделано намеренно и закреплено тестами. В src/rules/apps.ts:416 стоит комментарий «the text-only re-list did not run or failed». Тест test/rules/apps.test.ts:119 называется 'APPS-019 does not run without the text-only re-list (it failed or no tool links a UI)'. freshTools (src/conn |

## 4. Improvements (not adversarially verified; triage by maintainer)

| ID | Sev | File | Title | Suggested change |
|---|---|---|---|---|
| F025 | medium | `src/protocol/modern.ts` | ModernClient всегда читает тело с fullBody (64 MiB / полный timeout), включая пробы badVersion/unknownMethod/headerMismatch | Добавить в ModernRequestOptions `fullBody?: boolean` (по умолчанию true только для tools/list, resources/read, server/discover) и передавать false из wire.ts. |
| F029 | medium | `src/probe/active.ts` | Синтез аргументов игнорирует format/pattern/min*/enum-в-items/вложенные required — «synthetic» вызовы массово падают на валидации | Рекурсивный синтез: объекты → заполнять required-свойства; массивы → `[placeholder(items)]` при minItems>0; строки по `format` (uri → https://example.com, email → a@example.com, date-time → ISO now, uuid → randomUUID), учитывать `minimum`/`maximum`/`minLength`; `anyOf/oneOf` → первая ветка; `$ref` → резолв по `$defs`. Записывать в ActiveCall причину, если синтез невозможен. |
| F049 | medium | `src/rules/spec.ts` | SPEC-005 + SPEC-006 + SPEC-015 дублируют друг друга на modern-only сервере (5 финдингов на 2 факта) | Оставить modern-only семантику целиком в SPEC-015: в SPEC-005 `if (isModernOnly(snap)) return []`, в SPEC-006 убрать ветку строки 150 (формат id проверять всегда). Решить severity SPEC-015 для MUST-кейсов (error) либо явно задокументировать warning. |
| F050 | medium | `src/rules/server.ts` | SRV-013 и SPEC-001 оба выдают spec error за отсутствующий initialize.serverInfo | Убрать проверку serverInfo из SPEC-001 (оставить shape protocolVersion/capabilities/instructions) и сослаться на SRV-013, либо наоборот. |
| F051 | medium | `src/rules/auth.ts` | AUTH-002/AUTH-004/AUTH-013 дают три error за одну причину (сервер без OAuth-discovery) | В AUTH-013 второй блок выполнять только когда `a.challenge?.raw` есть, но не Bearer (т.е. явно другая схема); при полном отсутствии discovery оставить AUTH-004 как единственный error, AUTH-002 — info «no challenge either». |
| F052 | medium | `src/rules/auth.ts` | AUTH-017: claude=error по одному медленному сэмплу из трёх — недетерминированная метрика как блокер | Использовать медиану (как SRV-010) или требовать ≥2 из 3 сэмплов выше порога для error; одиночный выброс — warning с текстом «1 of 3 samples». |
| F076 | medium | `src/rules/tools.ts` | Нет платформенного правила на точку `.` и символы имени для Claude/OpenAI (API обоих вендоров принимают только `[a-zA-Z0-9_-]`) | Добавить правило (например TOOL-033) `claude: error, chatgpt: error`: имя не матчит `^[A-Za-z0-9_-]{1,64}$` (с перечислением символов), и расширить TOOL-002 на chatgpt. Проверить лимиты по официальным ссылкам и указать их в sources. |
| F101 | medium | `src/rules/util/html.ts` | extractOrigins не видит ES-module импорты и importmap — APPS-007 пропускает самый частый способ подключения ext-apps | Добавить в jsPatterns: `['resource', /\bimport\s*(?:[^;'"`]{0,120}?\bfrom\s*)?${lit}/g]`, `['resource', /\bimport\(\s*${lit}/g]`, а для `<script type="importmap">` парсить JSON и добавлять все https-значения из imports/scopes как resource (confidence tag). |
| F102 | medium | `src/rules/apps.ts` | APPS-013: `<a href="https://…" target="_blank">` не считается navigate — правило срабатывает только на openExternal/ui/open-link | В extractOrigins добавить `a` в tagRe и `add('navigate', attr(tag,'href'), tag, 'tag')`; с confidence tag, но severity warning (уже дефолт правила). |
| F103 | medium | `src/rules/runtime.ts` | RT-011 сканирует только text-items; инъекция в structuredContent не детектируется | Собирать текст также из всех строковых листьев structuredContent (walkJson уже есть в файле) и из `resource`/`resource_link` items; указывать в message, где найдено. |
| F150 | medium | `package.json` | main указывает на CLI, нет exports/types — программный API заявлен в CHANGELOG, но не поддерживается пакетом | Либо добавить `src/index.ts` (экспорт runCli, buildSnapshot, runRules, RULES, buildReport, render*), `declaration: true`, `"exports": {".": "./dist/index.js", "./package.json": "./package.json"}`, `"types": "dist/index.d.ts"`; либо убрать `main` и явно написать в README «CLI only, no programmatic API yet». |
| F151 | medium | `.github/workflows/ci.yml` | Матрица CI и engines держатся за Node 20, который достиг EOL 2026-04-30 | В 0.2.0: `engines.node: ">=22.12"`, матрица `['22', '24']`, `@types/node ^22`, снять dependabot ignore; упомянуть в CHANGELOG под Changed. До этого — хотя бы сократить матрицу: 20.19 только на ubuntu. |
| F156 | medium | `vitest.config.ts` | Нет измерения покрытия; ряд модулей src не имеет прямых unit-тестов и проверяется только через spawn CLI | Добавить `@vitest/coverage-v8`, скрипт `test:coverage` с `coverage.include: ['src/**']` и порогами (например lines 85%), публиковать в CI как артефакт. Написать unit-тесты для legacy.listAll (maxPages, repeated cursor, error), manualChecklist (feature filter), wire-проб с мок-fetch. |
| F168 | medium | `README.md` | Рыночные возможности: GitHub Action, baseline-режим, конфиг-файл, линт листингов, JUnit, OAuth-helper | Приоритет: action.yml (composite, оборачивает npx + upload SARIF) → `--baseline` → конфиг-файл → `--listing/--plugin` → `--format junit` → `--oauth`. Каждое — minor-релиз с записью в CHANGELOG. |
| C-imp-5 | low | `src/connect.ts` | Сбой stdio-handshake теряет non-JSON stdout: «Request timed out» без подсказки, что сервер пишет мусор в stdout | Пробрасывать nonJson из connectStdio в ошибку (как stderrTail) и сохранять в snap.transport.stdio на fatal-пути; в fatal-сообщение добавлять «stdout: <первая non-JSON строка>»; снять need-блокировку SRV-018 при наличии строк. |
| C-imp-6 | low | `src/connect.ts` | Диагностика 403 игнорирует тело/заголовки: Cloudflare challenge описывается как «HTTP 403 (forbidden)», а SRV-009 трижды репортит одну причину | Для 403 передавать contentType/body/headers в диагностику: при cf-mitigated/«Just a moment»/WAF-сервере давать summary «blocked by a bot challenge (Cloudflare)» с hint про allowlist; в SRV-009 сводить признаки одного exchange в одну находку. |
| C-imp-7 | low | `src/rules/runtime.ts` | --active: результат вызова invalid-missing ({} при required-параметрах) не оценивается — успешный ответ на пустые аргументы не репортится | Расширить RT-002 на kind 'invalid-missing' (отдельное сообщение «missing required argument accepted») или убрать вызов, если он не нужен; исключить invalid-* вызовы из RT-004. |
| F011 | low | `src/cli.ts` | Один и тот же exit 3 для «не подключились» и «остановлено --max-duration» — CI не может различить | Ввести exit 4 для `limits.stopped && !fatal` (с флагом совместимости или в 0.2.0), задокументировать в HELP/README/spec §3.2. |
| F012 | low | `src/connect.ts` | Каждая строка stdout сервера парсится JSON.parse дважды, nonJson не ограничен | Дешёвый предфильтр `/^\s*[\[{]/` перед JSON.parse (или помечать строку как JSON только если SDK onmessage её принял); ограничить nonJson, например 200 строк / 64 KB, с отметкой в limits.truncated. |
| F013 | low | `src/limits.ts` | Input caps не покрывают listMeta.rawPages, toolsWithoutUi и active.calls[].result, по которым тоже бегают правила | Добавить в capSnapshot проход по `listMeta[*].rawPages`, `toolsWithoutUi`, `active.calls[*].result` с TEXT_CAP (и/или отдельным CALL_CAP). |
| F015 | low | `src/cli.ts` | --timeout/--max-duration принимают 0x10, 1e2, 1.5 через Number() | Проверять `/^\d+$/.test(values.timeout)` перед Number(). |
| F016 | low | `src/cli.ts` | --target/--format/--fail-on чувствительны к регистру, а --ignore и explain — нет | `values.target.toLowerCase()` и т.п. перед проверкой списка. |
| F017 | low | `src/connect.ts` | GroupStdioTransport копирует приватные внутренности SDK (_process, _readBuffer, processReadBuffer) — тихая поломка при bump SDK | Проверка при старте (`if (typeof self.processReadBuffer !== 'function' \|\| !('_serverParams' in self)) throw new Error('unsupported SDK')`) + тест, пинующий форму приватного API; либо предложить upstream опцию `detached`/`spawnOptions`. |
| F030 | low | `src/probe/network.ts` | Сырые initialize-пробы (preflight, 4 origin, invalid-token, redirect-хопы) создают на сервере сессии, которые никогда не закрываются | В requestRetried/tracer: если ответ 2xx на initialize содержит `mcp-session-id`, запланировать `DELETE url` с этим id (best-effort, без ретраев) в конце run. Спек §4.3 обещает «side-effect-free». |
| F031 | low | `src/probe/network.ts` | TLS-проверка с фиксированным 10 с таймаутом и до 3 попыток не подчиняется --timeout/--max-duration | Передавать в Deps.tlsCheck `timeoutMs = Math.min(opts.timeoutMs, 10000)` и `AbortSignal` (progress.abort), прерывать ретраи при abort. |
| F032 | low | `src/protocol/legacy.ts` | listAll (legacy) и ModernClient.listAll по-разному обрабатывают не-объекты в списках | Вынести общий `paginate(fetchPage)` и единообразно либо отбрасывать примитивы с записью в listMeta.error/ObservedError («non-object entry in tools/list»), чтобы SPEC-правило могло это отрепортить. |
| F033 | low | `src/protocol/recording.ts` | RecordingTransport: pending растёт без очистки, transportErrors никем не читается | `this.pending.delete(m.id)` после записи; пробрасывать `transportErrors` в `snapshot.transport.observedErrors` (source: 'transport') или в connectDiagnosis. |
| F034 | low | `src/protocol/trace.ts` | Ручной linkAbort ради Node 18, хотя engines теперь >=20.19 (AbortSignal.any доступен) | Заменить на AbortSignal.any/timeout; обновить §4.4 spec.md под Node 20.19+. |
| F035 | low | `src/protocol/trace.ts` | redactUrl для exchanges маскирует только по имени параметра, в отличие от displayUrl (известные форматы токенов, path-сегменты) | В redactUrl переиспользовать логику displayUrl (isKnownToken для значений/сегментов, очистка userinfo), затем scrub. |
| F036 | low | `src/protocol/trace.ts` | finishBody скрабит всё тело (до 64 MiB) ради 4 KB сниппета, а полный parsed JSON каждого exchange остаётся в памяти | Скрабить `text.slice(0, SNIPPET + maxSecretLen)`; для `fullBody` возвращать JSON вызывающему, а в exchange хранить только сниппет/размер (или ослабленную ссылку), чтобы не держать N копий больших списков. |
| F037 | low | `src/probe/auth.ts` | PRM-кандидат из заголовка дублирует well-known путь → лишние запросы и тайминг-сэмплы; retry-бюджет auth probe не ограничен сверху | Дедуплицировать кандидатов по href; для metadata-GET использовать меньший таймаут (например min(timeoutMs, 10 с)) и общий бюджет попыток на auth probe; проверять progress.abort между кандидатами. |
| F053 | low | `src/rules/auth.ts` | AUTH-008: при отсутствии поля issuer сообщение «metadata issuer undefined !== …» | `if (!isStr(m.issuer)) return [{ message: 'metadata has no string issuer (RFC 8414 REQUIRED)' }];` перед сравнением. |
| F054 | low | `src/rules/server.ts` | SRV-006: редирект только на GET (при рабочем POST) — claude error, хотя handshake Claude идёт через POST | Для `ex.method === 'GET'` понижать до warning (или оставить SPEC-005), error — только для POST preflight. |
| F055 | low | `src/rules/server.ts` | SRV-015: слово «sampling» в описании инструмента трактуется как MCP sampling | Сузить: `/sampling\/createMessage\|\bMCP sampling\b\|\bsampling (request\|capabilit(y\|ies))\b\|createMessage/i` и/или проверять только instructions, а не описания параметров. |
| F056 | low | `src/rules/spec.ts` | SPEC-017: `sizes` строкой (не массивом) молча принимается; `image/jpg` в allow-list не является валидным MIME | При не-массиве sizes — warning «sizes must be string[]»; `image/jpg` перенести в info-ветку («use image/jpeg»). |
| F057 | low | `src/rules/auth.ts` | AUTH-006 валидирует только authorization_servers[0], хотя ChatGPT-правила опрашивают до 3 серверов | Пройти по `list.slice(0,3)`, для i>0 выдавать `platforms:['chatgpt']` с тем же сообщением и индексом. |
| F058 | low | `src/rules/auth.ts` | AUTH-007 «tried nothing» при непарсящемся issuer дублирует AUTH-006 | В AUTH-007 пропускать записи с `attempts.length === 0 && !as.json` когда issuer не парсится (`try new URL(as.issuer)`), оставив вердикт AUTH-006. |
| F059 | low | `src/rules/server.ts` | SRV-010: в медиану попадают неуспешные/служебные вызовы (discover-проба на legacy, preflight 401, badVersion 400) | В tracer писать timings только для 2xx (или хранить `{ms,status,label}`), в SRV-010 фильтровать по 2xx и исключать лейблы проб (`badVersion`, `origin *`, `preflight`, `auth invalid-token`). |
| F060 | low | `src/rules/spec.ts` | SPEC-010 не замечает сервер, отдающий реальный контент для несуществующего URI | При `v.result` с непустым contents — info/warning «resources/read of a missing URI returned content (catch-all template?)». |
| F077 | low | `src/rules/tools.ts` | TOOL-004/005/014/015: эвристики по токенам не учитывают контекст (url в shorten_url, like в описании, hex в именах) | Для «like» требовать следующий токен-пример в кавычках/после двоеточия или ограничить `like` формой «like:`/`like "`; для url-токена в TOOL-015 требовать свободный url-параметр (уже проверяется ниже) вместо только имени; в TOOL-027 исключать имена с write-глаголом после read-глагола. |
| F078 | low | `src/rules/util/text.ts` | escapeHidden экранирует ZWJ внутри составных эмодзи — заголовки с 👨‍💻 показываются как «👨\u{200D}💻» | Не экранировать U+200D, если и предыдущий, и следующий code point — `\p{Extended_Pictographic}` (или использовать Intl.Segmenter grapheme и экранировать только Cf вне графем с эмодзи). |
| F079 | low | `src/rules/schema.ts` | TOOL-017 с `strict:false` не ловит типовые ошибки схем, которые ломают хосты: неизвестные ключевые слова/опечатки (`require`, `propeties`), `format` неизвестного типа, `required` с несуществующими свойствами | Добавить info-правило: `required` ссылается на отсутствующие свойства (кроме схем с additionalProperties/patternProperties); опечатки известных ключевых слов по расстоянию Левенштейна ≤1 (`require`, `propeties`, `additionalProperty`); неизвестный `format` вне списка JSON Schema/OpenAPI. Прогонять TOOL-020 и для outputSchema. |
| F080 | low | `src/rules/tools.ts` | Нет правил о количестве инструментов и общем объёме описаний (контекстный бюджет), которые директории реально проверяют | Добавить info-правило «Tool list budget»: N tools > 40 или JSON.stringify(tools).length > 64 КБ (пороги linter-defined, вынести в limits.ts), с сообщением о токенах контекста и рекомендацией объединять/прятать редкие инструменты. |
| F081 | low | `src/rules/util/schemaWalk.ts` | Дедупликация `seen` по объекту в walkSchema скрывает повторно используемые $ref-цели у второго и последующих параметров | Хранить `seen` как множество пар (node, path-prefix) или ограничивать защитой от циклов только текущий стек (ancestors), а не глобальным Set; тогда повторная цель обходится один раз на каждый вход, цикл всё равно обрывается. |
| F104 | low | `src/rules/runtime.ts` | RT-010 LEAK_KEY флагует ключи, явно объявленные в outputSchema (logs, session_id, request_id) | Собрать множество имён properties из outputSchema (walkSchema) и исключать их из LEAK_KEY-находок; понижать `request_id`/`logs` до info, если имя инструмента содержит log\|trace\|debug\|session. |
| F105 | low | `src/rules/runtime.ts` | RT-010 TOKEN_RE дублирует и сужает KNOWN_TOKEN из util/net.ts | Экспортировать из net.ts не-заякоренную версию KNOWN_TOKEN (или `findKnownTokens(text)`) и использовать в RT-010. |
| F106 | low | `src/rules/apps.ts` | APPS-006: при одновременном ui.csp и openai/widgetCSP одна и та же запись репортится дважды | Дедуплицировать по `(value, kind)` в cspOf.entries или в APPS-006 по `${kind}\|${v}`; в message перечислять оба поля. |
| F107 | low | `src/rules/apps.ts` | normalizeMime не снимает кавычки параметра — `text/html; profile="mcp-app"` считается неверным MIME | В normalizeMime раскавычивать значение: `p.replace(/^([^=]+)="?([^"]*)"?$/, (_, k, v) => k.toLowerCase() + '=' + v)`. |
| F108 | low | `src/rules/apps.ts` | APPS-015: пользовательские функции с именами prompt/confirm/alert ловятся как браузерные диалоги | Пропускать, если в HTML есть объявление `(const\|let\|var\|function)\s+(alert\|confirm\|prompt)\b` или параметр с таким именем; применять stripComments перед поиском. |
| F109 | low | `src/rules/injection.ts` | Находки INJ-* для prompts не содержат имени промпта (subject теряется) | В `finding()`/`locationOf()` включать subject: `prompt "summarize" description: …`, либо расширить RawFinding полем `prompt?: string` и выводить его в репортерах как subject. |
| F113 | low | `src/rules/data.ts` | DATA-004: список restricted-data имён неполный (card_cvc, exp_month/exp_year, routing_number, account_number, passport_no, license_number, aadhaar, nino) | Перейти на суффиксно-токенную проверку (как isSecretName): токены {cvv, cvc, cvv2, ssn, passport, aadhaar, nino, sin, mrn} в любом сегменте; пары card+(number\|exp\|expiry\|cvc), bank+account\|routing+number. |
| F114 | low | `src/rules/injection.ts` | INJ-003: `<Secret>`/`<hidden>` как описание XML/HTML-элементов в легитимной документации | Добавить в Pattern `unless: /\b(element\|tag\|node\|xml\|markup\|attribute)\b/i` (40 символов после матча) или понижать до info при таком контексте. |
| F125 | low | `src/rules/engine.ts` | Сортировка через localeCompare зависит от ICU/локали процесса — порядок находок в JSON/SARIF может различаться между машинами | Заменить на компаратор по code units (`a < b ? -1 : a > b ? 1 : 0`) или `localeCompare(b, 'en')` везде. |
| F127 | low | `src/report/markdown.ts` | text() не экранирует emphasis/strike/math — серверный текст может менять вид H1 и ячеек | Добавить в ESC: '*','_','~','$','#' (как `\*` и т.д.); либо показывать серверные имена в code span. |
| F128 | low | `src/report/json.ts` | JSON server.command склеивает argv пробелами — необратимо для аргументов с пробелами | Добавить в JSON `server.argv: string[]` (и оставить command как display через cmdQuote). Поскольку это добавление поля, JSON_SCHEMA_VERSION можно не поднимать. |
| F129 | low | `src/report/json.ts` | JSON не содержит rootCauses, из которых считается score — summary.score невоспроизводим из JSON | Добавить `summary.rootCauses: {errors, warnings}` (аддитивно) и опционально `scoredFindings` ids; задокументировать в README. |
| F131 | low | `src/report/github.ts` | Нет защиты от лимита GITHUB_STEP_SUMMARY (1 MiB) и большого числа аннотаций (10 per step) | Группировать аннотации по правилу (как groupFindings в text) и ограничивать ~10 с финальной «+N more, see summary»; перед записью summary проверять Buffer.byteLength ≤ 1 MiB и при превышении писать сокращённую версию (без Evidence). |
| F132 | low | `src/redact.ts` | В URL редактируются только токены известных форматов и секретные имена — hex/base64 ключи в пути или под нейтральным именем остаются | Для path-сегментов и query-значений добавлять эвристику: ≥24 символов из [A-Fa-f0-9] или base64url с цифрами и буквами и без словарных разделителей — маскировать с пометкой; дать `--no-redact-heuristic` для отключения. |
| F133 | low | `src/rules/engine.ts` | Need 'legacy' считается выполненным для stdio с era 'modern' | Либо `LEGACY_ERAS.has(snap.era)` для всех транспортов, либо комментарий «stdio has no era split; legacy-shaped checks always apply» + тест в engine.test.ts. |
| F134 | low | `src/report/text.ts` | fixSnippets завязан на точный текст сообщения TOOL-006 ('no title') | Отбирать tools по данным snapshot (нет title и/или нет hints) с проверкой, что соответствующее правило вообще выдало находку по этому tool, без сравнения message. |
| F145 | low | `.github/workflows/release.yml` | Release/CI: постоянный fallback на NPM_TOKEN и npm ci без --ignore-scripts | После первого релиза удалить строки NODE_AUTH_TOKEN (или условие `if: secrets.NPM_TOKEN == ''` невозможно — проще убрать), добавить шаг-проверку, что публикация прошла с provenance (`npm view … --json \| jq .dist.attestations`). В `npm ci` добавить `--ignore-scripts` (esbuild работает без postinstall, т.к. бинарь приходит из @esbuild/linux-x64; проверить прогон vitest) хотя бы в release.yml. |
| F146 | low | `src/limits.ts` | Input caps применяются слишком поздно и не покрывают все серверные данные | Ввести `BUDGET` (например 64 МБ суммарно на снапшот) с учётом в readBody/listAll/reader и ранним прекращением, записывая в snap.limits.truncated; capStrings применять и к active.calls, modernResults, rawPages; ограничить число элементов списков. |
| F147 | low | `src/report/markdown.ts` | Markdown-рендерер не экранирует управляющие/невидимые символы (ESC, bidi U+202E, zero-width) | Применять escapeHidden (или замену \p{Cc}\p{Cf} на \u{..}) внутри text() и cell() для всех серверных строк; в code() — тоже (внутри code span управляющие символы всё равно не нужны). |
| F155 | low | `tsconfig.json` | lib: DOM ради типов fetch втягивает все браузерные глобалы в Node-код | Убрать DOM/DOM.Iterable, прогнать `npm run typecheck`; недостающие типы (например `RequestInit`) брать из `undici-types` или `node:` глобалов. Если без DOM не собирается — зафиксировать причину комментарием в tsconfig. |
| F159 | low | `.github/workflows/ci.yml` | cancel-in-progress: true для всех ref — отменяет и запуски на main; npm audit в PR-CI делает сборку красной от чужих advisories | `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. Перенести npm audit в `schedule: cron` workflow (или `continue-on-error: true` в PR). Добавить biome/eslint с `npm run lint` в CI. |
| F160 | low | `.github/workflows/release.yml` | NODE_AUTH_TOKEN всегда задан (возможно пустой) при trusted publishing — поведение «OIDC is used when it is empty» не подтверждено | Разнести на два шага: `if: env.HAS_TOKEN == 'true'` (вычислить в предыдущем шаге `echo HAS_TOKEN=${{ secrets.NPM_TOKEN != '' }}`) публикует с токеном, иначе шаг без `NODE_AUTH_TOKEN`; либо после настройки trusted publisher удалить упоминание секрета из workflow целиком. |
| F161 | low | `src/cli.ts` | --tool-args принимается без --active, а неизвестные/не read-only имена инструментов в нём молча игнорируются | UsageError «--tool-args needs --active» (или notice на stderr); после runActive вывести в `limits`/notes список ключей --tool-args, не сопоставленных ни с одним вызванным инструментом, с причиной (unknown tool / not read-only / beyond the 50-tool cap). |
| F164 | low | `scripts/rules-table.mjs` | rules-table.mjs --write синхронизирует дату в примере отчёта, но не версию; сообщение об успехе упоминает только docs/RULES.md | Читать version из package.json и заменять `^mcp-review-check \S+ · rules` на `mcp-review-check ${version} · rules ${CATALOG_DATE}`; в docs.test.ts сверять версию с VERSION; поправить текст сообщения. |
| F165 | low | `test/compat.test.ts` | Замороженный список ID правил дублируется в compat.test.ts и catalog.test.ts, CONTRIBUTING упоминает только один | Вынести baseline-список в test/fixtures/baseline/rule-ids.json и импортировать в оба теста; в CONTRIBUTING перечислить все файлы, которые трогает новое правило (catalog.test, compat baseline, real-servers ACCEPTED_NEW, docs). |
| F166 | low | `.gitignore` | .gitignore не исключает *.tgz, которые создаёт npm pack (release.yml, локальная проверка) | Добавить `*.tgz` в .gitignore. |
| R011 | low | `src/protocol/legacy.ts` | Нестроковый nextCursor молча завершает пагинацию: листинг обрезается без ошибки | Различать два случая: `next === undefined \|\| next === null` означает конец, любое нестроковое значение даёт error `nextCursor is not a string (got number)`. Тогда SPEC-020 или отдельное правило покажет проблему. Пустую строку можно считать концом, но с info. |
| R012 | low | `src/connect.ts` | Сессии Streamable HTTP не завершаются (DELETE не отправляется): за один прогон на сервере остаётся 7–10 открытых сессий | Перед `client.close()` для kind 'streamable-http' вызывать `(conn.rec.inner as StreamableHTTPClientTransport).terminateSession().catch(()=>{})` в buildHttp и freshTools. Для сырых initialize-проб отправлять DELETE с полученным Mcp-Session-Id. 405 на DELETE допустим. |
| R015 | low | `src/explain.ts` | explain и --list-rules не показывают needs правила и feature MAN-пункта; explain MAN не печатает подсказку --ignore, обещанную README | Добавить в explain строку `Runs when  needs: active (--active), http` и для MAN строки `Shown when  [oauth]` и `To hide it: --ignore MAN-007`. В текстовом --list-rules --verbose печатать needs. |
| R018 | low | `src/cli.ts` | --ignore со списком через запятую отвергается сообщением, которое скрывает значение: «--ignore value is not a rule or MAN ID» | Разбивать значение --ignore по запятым (`values.ignore.flatMap(v => v.split(','))`) либо при наличии запятой выдавать подсказку «give --ignore once per ID». |
| R022 | low | `src/report/score.ts` | Экспортируемая failed() по умолчанию учитывает spec, в отличие от CLI; в продакшен-коде не используется | Удалить failed() и перевести тесты на gate(...).failed, либо сделать умолчание gatedPlatforms('all'). |
| R035 | low | `src/rules/apps.ts` | Запись CSP без схемы (`api.example.com`) даёт сразу APPS-006 «not an origin» и APPS-007 «not declared» | В originMatches считать запись без схемы host-source (совпадение по хосту, схема https/wss), а в APPS-006 оставить одну находку «add scheme». Либо в APPS-007 не дублировать, если запись уже помечена APPS-006. |
| R036 | low | `src/rules/util/ui.ts` | cspOf молча игнорирует неизвестные ключи CSP (camelCase внутри openai/widgetCSP, опечатки) — APPS-007 выдаёт error без подсказки о причине | В cspOf собирать `unknown` ключи; в APPS-005 выдавать warning «unknown CSP field X (did you mean connect_domains?)». |

## 5. Areas the round-1 critic flagged as uncovered (all reviewed in round 2; see `evidence/04-round2/area-notes.json` for what was checked and found clean)

- --max-duration: withDeadline/stoppedSnapshot/checkpoint (connect.ts:547-666), гонки между брошенным run и detached-копией snapshot
- Обработка сигналов в cli.ts isMain (двойной SIGINT, exit-коды 130/131/143), endAllNow/endChildren на реальном процессе
- SSE-fallback (connectSse) и legacy HTTP+SSE-эра: ни одного сквозного сценария
- src/protocol/modern.ts: пагинация listAll, SSE-ответы, сессии для modern-only сервера (кроме F025/F137)
- src/report/score.ts (корневые причины, n/a-логика) и src/report/index.ts (verdicts/gate) — сквозная проверка соответствия exit-кода README
- src/report/github.ts кроме лимитов (F131): экранирование ::error для многострочных сообщений
- src/explain.ts и --list-rules --format json/markdown
- capStrings (limits.ts) обрезает ВСЕ строки tool-объекта, включая name/pattern/enum/$ref: возможные ложные TOOL-017/TOOL-003 после обрезки — не проверено
- src/rules/apps.ts в целом (APPS-001..019 кроме F101/F102/F106-F108), особенно APPS-019 с toolsWithoutUi
- Реальный запуск на Windows (spawn, taskkill, cmdQuote в rerun); на macOS/Linux только эмуляция в тестах
- Поведение при --bearer: preflight уходит без авторизации (preflight(tracer, url, …) не получает authHeaders), auth-probe запускается и при валидном токене — намеренность не проверялась
- SDK ReadBuffer (shared/stdio.js) без лимита длины строки — упирается в MAX_STRING_LENGTH/квадратичный concat, тяжёлый репро не запускался

