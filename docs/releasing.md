# Выпуск версии

## Подготовка исходников

Обновите версию в `package.json`, lock-файл и `CHANGELOG.md`. Зафиксируйте изменения в релизном commit и начните проверки с чистой рабочей копии:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm run test:dependencies
npm audit --audit-level=moderate
COMMAND_HOTKEYS_PACK_TEST=1 npm test
node .github/scripts/package-smoke.mjs
```

Проверьте ручные сценарии из [Тестирования](verification.md) и результат CI для релизного commit. Рабочая копия должна оставаться чистой после проверок.

Тег имеет вид `v<version>`, например `v0.1.0`. Он должен существовать в remote и указывать на тот же commit, который используется для сборки; его версия должна совпадать с `package.json`.

## Черновик GitHub Release

Запустите workflow `Prepare draft release` через `workflow_dispatch`:

| Поле | Значение |
| --- | --- |
| `ref` | Полный SHA релизного commit |
| `version` | Версия без `v`, например `0.1.0` |
| `tag` | Существующий тег, например `v0.1.0` |
| `confirmation` | `CREATE_DRAFT` |

Workflow проверяет tag/version/HEAD, повторяет сборку, тесты и полный аудит. Затем создаёт tarball и `SHA256SUMS`, прикладывая их к черновику GitHub Release. Тег не создаётся, существующий релиз не перезаписывается. Push ветки или тега не запускает этот workflow.

При сбое проверьте, появился ли черновик и какие вложения загружены, прежде чем повторять запуск.

## Проверка артефакта

Скачайте `.tgz` и `SHA256SUMS` из черновика в отдельный каталог. Проверьте сумму:

```sh
sha256sum -c SHA256SUMS
# macOS:
shasum -a 256 -c SHA256SUMS
```

Просмотрите архив через `tar -tzf /absolute/path/opencode-command-hotkeys-0.1.0.tgz`: нужны `dist`, manifest, лицензия и документация; локальные настройки и секреты в архив попадать не должны.

Установите этот же архив в отдельный тестовый каталог:

```sh
npm install --ignore-scripts /absolute/path/opencode-command-hotkeys-0.1.0.tgz
```

Подключите установленный каталог пакета в `cli.json` и проверьте команды и переключение Goal. Не пересобирайте архив между проверкой и публикацией.

## Публикация

Для стабильной версии из примера опубликуйте проверенный архив:

```sh
npm publish /absolute/path/opencode-command-hotkeys-0.1.0.tgz --access public --tag latest
npm view opencode-command-hotkeys@0.1.0 version dist.integrity
```

Затем проверьте установку именно из registry в новом каталоге:

```sh
npm install --ignore-scripts opencode-command-hotkeys@0.1.0
```

Проверьте содержимое установленного пакета и подключение в OpenCode. Опубликуйте подготовленный черновик GitHub Release, сохранив проверенные `.tgz` и `SHA256SUMS`. Для другой версии замените номер во всех командах, имени архива и теге.

## Откат

Верните в `cli.json` путь к предыдущей установленной версии или удалите запись плагина. Проверьте, что старые привязки больше не активны. Для проблемной npm-версии рассмотрите deprecate с пояснением и выпуск исправленной версии; не подменяйте содержимое уже выпущенного архива
