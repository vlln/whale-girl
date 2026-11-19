<p align="center"><a href="README.zh.md">中文</a> | <a href="README.md">English</a> | Русский</p>

<h1 align="center">whale-girl</h1>

<p align="center">
  <strong>Десктопный питомец в веб-GUI DSH (в стиле QQ-питомца)</strong><br/>
  Постоянная компаньонка, парящая в правом нижнем углу: её можно таскать, кормить
  и играть с ней — выполненные задачи, сессии и время совместного общения копятся
  в уровни стажа, титулы и воспоминания.
</p>

<p align="center">
  <img src="https://badgen.net/badge/license/MIT/green" alt="license" />
  <img src="https://badgen.net/badge/format/official%20bundle/8257D0" alt="official bundle" />
  <a href="https://dshfind.com/en/plugins/vlln/whale-girl?ref=badge"><img src="https://dshfind.com/api/badge/vlln/whale-girl" alt="dshfind" /></a>
  <a href="https://www.dsh.so/artifact/whale-girl"><img src="https://www.dsh.so/badge/whale-girl.svg" alt="dsh.so security" /></a>
</p>

---

## Установка

Официальный **bundle-плагин** (`dsh.bundle` + `dsh.client` в корневом `package.json`), управляется через официальный профиль:

```sh
dsh plugin --profile web add whale-girl                        # npm source (build artifacts ship in the package)
# to track the latest commit instead: dsh plugin --profile web add "github:vlln/whale-girl#main"
# or local directory: dsh plugin --profile web add <path-to-whale-girl>
```

После установки **перезапустите web** (слои bundle собираются при старте); питомец появится в правом нижнем углу: щёлкните, чтобы открыть его меню (🍗 кормить / 🎾 играть), перетаскивайте, чтобы переместить, наведите курсор — появится строка состояния (уровень стажа / число задач / недавние общие воспоминания). На страницах онбординга скрыт.

Обновление — `dsh plugin --profile web update whale-girl` (или смена git-ссылки), затем перезапуск.

## Использование

| Вы / событие | Поведение питомца |
|---|---|
| Перетаскивание питомца | Вытягивается по диагонали (`drag`) |
| Меню 🍗 кормить / 🎾 играть | Чавканье / бросок мяча (`eat`/`play`) → радость (`joy`) |
| Простой ≥60 с | Дремлет (`sleep`); просыпается при взаимодействии (`wake`) |
| Задача выполнена / новый уровень / титул / раунд завершён | Ликует (`celebrate`) |
| Задача провалена / ошибка запроса | Вздрагивает (`error`) → разочарование (`disappointed`) |
| Новая сессия | Приветственно машет (`welcome`) |
| Сессия работает / думает | Задумчиво составляет компанию (`think`, временами `working`) |
| Ожидание подтверждения | Выжидающе ждёт (`wait`) |
| Периодические прогулки | Идёт (`walk`) |
| По умолчанию | Спокойное ожидание (`idle`, случайные моргания / повороты) |

Полная машина состояний (приоритеты / переходы / триггеры): [docs/state-machine.md](docs/state-machine.md).

## Десктопная компаньонка (опционально)

`desktop/` — **самостоятельное приложение-компаньон** (движок Node + оболочка Tauri, без runtime-зависимостей), которое держит китовую девочку на десктопе вашей ОС. **Не устанавливается через `dsh plugin`** — включите вручную:

```sh
# Prereqs: Node ≥18; the rendering shell needs Rust (cargo)
npm install -g whale-girl-desktop   # npm install (engine + Tauri shell source included)
whale-girl-desktop --headless       # headless: presence heartbeat + state polling + SSE
cd "$(npm root -g)/whale-girl-desktop/src-tauri" && cargo build --release  # first build ~5-15 min; artifact target/release/whale-girl-desktop (~12MB)
./target/release/whale-girl-desktop   # transparent always-on-top desktop pet (defaults to local DSH on 3080)
# WHALE_GIRL_BASE_URL=http://IP:PORT points at a non-local DSH
# or from source: cd desktop && npm install && cd src-tauri && cargo build --release
```

- Использует публичные эндпоинты whale-girl (`/state`, `/events`, `/presence`, `/interact`, `/config`, `/assets`), **не трогая плагин**; пока приложение работает, питомец на странице скрывается (контракт присутствия) и возвращается после выхода или падения (TTL 45 с).
- Оболочка: Tauri v2 (рекомендуется, ~12 МБ); legacy-оболочка Electron сохранена (`npm i -D electron`).
- Дизайн и контракты: `desktop/DESIGN.md`, `desktop/BUILD-RUN.md`.

## Предпросмотр состояний

| Состояние | Триггер | Предпросмотр |
|---|---|---|
| `idle` | Стандартное ожидание | ![idle](docs/preview/idle.gif) |
| `working` | Случайный рабочий период, пока сессия думает | ![working](docs/preview/working.gif) |
| `celebrate` | Задача выполнена / новый уровень / титул / раунд завершён | ![celebrate](docs/preview/celebrate.gif) |
| `error` | Задача провалена / ошибка запроса | ![error](docs/preview/error.gif) |
| `disappointed` | Короткое уныние после неудачи | ![disappointed](docs/preview/disappointed.gif) |
| `joy` | Радость после кормления / игры | ![joy](docs/preview/joy.gif) |
| `eat` | Клик для кормления | ![eat](docs/preview/eat.gif) |
| `play` | Клик для игры | ![play](docs/preview/play.gif) |
| `drag` | Во время перетаскивания | ![drag](docs/preview/drag.gif) |
| `walk` | Периодические прогулки | ![walk](docs/preview/walk.gif) |
| `sleep` | Простой ≥60 с | ![sleep](docs/preview/sleep.gif) |
| `wake` | Переход пробуждения | ![wake](docs/preview/wake.gif) |
| `welcome` | Новая сессия | ![welcome](docs/preview/welcome.gif) |
| `think` | Компания, пока сессия думает | ![think](docs/preview/think.gif) |
| `wait` | Ожидание подтверждения | ![wait](docs/preview/wait.gif) |

## Настройка

**Plugins → Installed → whale-girl bundle page** (карточка конфигурации): высокочастотное подмножество — показ на странице, память сессии, размер, прозрачность, блуждание, задержка сна и наборы ответов на кормление/игру (по одному в строке). **Память сессии** (по умолчанию выключена) записывает вехи выполненных задач в локальный файл и при возобновлении/форке приветствует вас прогрессом прошлого раза — только локально, никогда не попадает в контекст модели и никогда не загружается; при выключении останавливаются все чтения и записи (файл сохраняется). Изменения **применяются сразу, без перезапуска** (переключатель пишется по клику; числа и наборы ответов — по потере фокуса или Enter).
Первая строка карточки — **строка обновления**: при монтировании она один раз проверяет источник (для установок из git — по коммиту, для установок из реестра — по версии) и показывает вердикт вместе с установленным коротким коммитом; при более новой ревизии кнопка превращается в "Update to <target>…", а обновление переустанавливает плагин через менеджер пакетов профиля DSH, не трогая ваши настройки. Полный контракт (эндпоинты, payloads, двухшаговая переустановка, причины неудач, требование к версии хоста): [docs/update-row.md](docs/update-row.md).

Полный список опций живёт в `config` записи плагина в патче профиля (`<dshHome>/profiles/<profile>/cordis.patch.yml`); секция `whale-girl:` в `<dshHome>/settings.yaml` импортируется в эту запись один раз:

```yaml
whale-girl:
  enabled: true      # web render toggle (false disables the in-page pet while a desktop companion runs)
  sessionMemory: false # session memory (local file; see the config card)
  size: 110          # pet size px (64–160)
  opacity: 1         # default opacity (0.2–1)
  walk:
    enabled: true    # wandering toggle
  sleepAfterMs: 60000
```

Полный список опций и причина, по которой семантический слой (XP / титулы) запечатан: `lib/src/config.mjs`. **Не настраивается** (изменение порогов XP / титулов сломало бы журнал накопления).

## Персонажи

🎭 «Switch Character» переключает персонажей (или задайте `whale-girl:character` в localStorage); кнопка **неактивна (серая), когда в манифесте один персонаж** («No other characters available»). Каждый персонаж поставляется **со всеми 15 состояниями** (полный контракт: [docs/sprites-spec.md](docs/sprites-spec.md)); новые персонажи: [docs/adding-a-character.md](docs/adding-a-character.md).

## Эталонная реализация

whale-girl — законченный образец **формата bundle-плагина** (`dsh.bundle` + `cordis.patch.yml` + `lib/`, развивающийся вместе с официальным механизмом): моделируйте по нему новые плагины:

- **Структура**: `lib/` (entry / logic / client / assets) отдельно от docs, decisions, scripts — корневой [AGENTS.md](AGENTS.md)
- **Соглашения**: гейты (`scripts/gates/run.mjs`) + записи решений + полные контракты ассетов; руководство: [make-dsh-plugin skill](https://github.com/vlln/plugin-registry/tree/main/skills/make-dsh-plugin) из plugin-registry, [cookbook](https://github.com/vlln/plugin-registry/blob/main/docs/cookbook/creating-a-plugin.md), [gotchas](https://github.com/vlln/plugin-registry/blob/main/skills/make-dsh-plugin/references/gotchas.md)

## Участие в проекте

**Issues и предложения приветствуются** — ваш отзыв определяет следующие шаги питомца:

- 🐛 **Баги**: заводите issue с шагами воспроизведения, версиями браузера и dsh; для клиентских проблем — ошибки консоли
- 💡 **Идеи функций**: см. [docs/state-machine.md](docs/state-machine.md) и [docs/growth-system.md](docs/growth-system.md), опишите ожидаемый эффект
- 🎨 **Новые персонажи**: [docs/adding-a-character.md](docs/adding-a-character.md) §quick guide — контракт только для чтения, 15 листов + записи манифеста, проверяется `verify-assets`
- 🔧 **Код**: каждое нетривиальное изменение требует записи решения (`decisions/`), самопроверок гейтов, одноцелевых коммитов ([docs/AGENTS.md](docs/AGENTS.md), корневой [AGENTS.md](AGENTS.md))

## Благодарности

Персонаж от [ZipZipPipe](https://space.bilibili.com/4168597) (персонаж-стикер «Whale Girl»); спрайты сгенерированы по их дизайну.

## Лицензия

MIT License
