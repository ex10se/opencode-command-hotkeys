# Участие в разработке

Нужны Node.js >=22.18.0 и npm. Используйте `package-lock.json`, чтобы воспроизводить дерево зависимостей.

## Подготовка

```sh
npm ci --ignore-scripts
npm run build
```

Для проверки в OpenCode 2.2.5 укажите каталог проекта в `cli.json`. Пример находится в [README](README.ru.md#конфигурация).

## Проверки

```sh
npm run typecheck
npm run build
npm run test:dependencies
npm audit --audit-level=moderate
COMMAND_HOTKEYS_PACK_TEST=1 npm test
node .github/scripts/package-smoke.mjs
```

Обычный `npm test` пропускает упаковочный тест. `COMMAND_HOTKEYS_PACK_TEST=1` включает создание tarball и установку в тестовый проект. Сценарии ручной проверки описаны в [Тестировании](docs/verification.md).

## Изменения

- Добавляйте регрессионный тест для исправляемого поведения.
- Сохраняйте совместимость обычных команд и переключения Goal.
- Не отправляйте черновик и не обходите модальные формы.
- При изменении схемы обновляйте оба README и справочник конфигурации.
- В pull request укажите воспроизведение, выполненные проверки и ограничения.
- Не включайте пользовательские диалоги, локальные настройки или секреты в fixtures и логи.

## Зависимости

`glob` 14.0.3 и `minimatch` 11.0.4 закреплены парными overrides: старый glob несовместим с API нового minimatch. При обновлении запускайте consumer-, security- и graph-проверки через `npm run test:dependencies` и полный audit, включая dev-зависимости. Удаляйте overrides после исправления upstream и успешного регрессионного прогона.

Порядок подготовки версии описан в [Выпуске версии](docs/releasing.md)
