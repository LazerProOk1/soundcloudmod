<p align="center">
<img src="https://raw.githubusercontent.com/zxcloli666/SoundCloud-Desktop/legacy/icons/appLogo.png" width="180px" style="border-radius: 50%;" />
</p>

<h1 align="center">SoundCloud Desktop — Мод</h1>

<p align="center">
<b>Форк SoundCloud Desktop с улучшениями и доработками</b><br>
Без рекламы · Без капчи · Миниплеер · Кроссфейд · Сохранение сессии
</p>

<p align="center">
<a href="https://github.com/LazerProOk1/soundcloudmod/releases/latest">
<img src="https://img.shields.io/github/v/release/LazerProOk1/soundcloudmod?style=for-the-badge&logo=github&color=FF5500&label=VERSION" alt="Version"/>
</a>
<a href="https://github.com/LazerProOk1/soundcloudmod/blob/main/LICENSE">
<img src="https://img.shields.io/badge/License-MIT-FF5500?style=for-the-badge" alt="License"/>
</a>
<a href="https://github.com/zxcloli666/SoundCloud-Desktop">
<img src="https://img.shields.io/badge/Оригинал-zxcloli666-888888?style=for-the-badge&logo=github" alt="Original"/>
</a>
</p>

---

![soundwave-banner](https://github.com/user-attachments/assets/826d01ed-71c3-4b35-9802-f82ac8cc28ab)

---

## Что это?

Форк проекта [SoundCloud Desktop](https://github.com/zxcloli666/SoundCloud-Desktop) — нативного десктопного приложения для SoundCloud на Tauri 2 + React 19.

В этом форке исправлены баги и добавлены дополнительные возможности по сравнению с оригиналом.

---

## Отличия от оригинала

### 🎛 Кроссфейд треков
Плавный переход между треками. Настраивается в настройках от 0 до 8 секунд.

### 🎨 Цвет акцента из обоев
Кнопка «Взять цвет из обоев» автоматически извлекает доминирующий яркий цвет с фона рабочего стола.

### 🪟 Рабочий миниплеер
Компактный плеер 360×96 поверх всех окон. Кнопки предыдущий/пауза/следующий полностью функционируют. Можно перетащить за обложку или название трека.

### 💾 Постоянная сессия
Авторизация и все настройки сохраняются между перезапусками приложения — больше не нужно каждый раз заходить заново.

### 🔧 Исправлен баг перемотки в конец
При перетаскивании ползунка в самый конец трека больше не происходит автоматическое переключение на следующий.

### 🎤 Страница артиста и страница альбома
Отдельные страницы для артистов с треками, альбомами и биографией. Страницы альбомов с полным трек-листом.

---

## Возможности (унаследованы из оригинала)

- **Без рекламы** — никаких баннеров и промо-вставок
- **Без капчи** — просто открываешь и слушаешь  
- **Работает в России** — без VPN и дополнительных программ
- **Нативное и лёгкое** — Tauri 2 (Rust), ~15 МБ, ~80–120 МБ RAM
- **Эквалайзер** — 10-полосный EQ
- **Управление с клавиатуры** — медиа-кнопки, MPRIS (Linux)
- **Discord Rich Presence** — показывает что слушаешь
- **Тексты песен** — синхронизированные и статичные
- **Очередь и шаффл**
- **Скорость и питч** воспроизведения
- **Таймер сна**
- **Дизлайк** — скрывает трек и не показывает снова

---

## Скачать

Перейди на [страницу релизов](https://github.com/LazerProOk1/soundcloudmod/releases/latest).

### Windows
- `.exe` — NSIS установщик (рекомендуется)
- `.msi` — альтернативный установщик
- Требования: Windows 10 (1809+) или Windows 11

### Linux
| Формат | Архитектура |
|--------|------------|
| `.deb` | amd64, arm64 |
| `.rpm` | amd64, arm64 |
| `.AppImage` | amd64, arm64 |

### macOS
- Apple Silicon: `*_arm64.dmg`
- Intel: `*_x64.dmg`

> **macOS Gatekeeper:** Если появляется ошибка «приложение повреждено»:
> ```bash
> xattr -cr /Applications/soundcloud-desktop.app
> ```

---

## Сборка из исходников

```bash
git clone https://github.com/LazerProOk1/soundcloudmod.git
cd soundcloudmod/desktop
pnpm install
pnpm tauri dev
```

**Production:**
```bash
pnpm tauri build
```

**Требования:** Node.js 22+, pnpm 10+, Rust 1.77+

---

## Стек

| Компонент | Технология |
|-----------|-----------|
| Оболочка | Tauri 2 (Rust) |
| Фронтенд | React 19, Vite 7, Tailwind CSS 4 |
| Стейт | Zustand, TanStack Query |
| Аудио | rodio (Rust) |
| UI | Radix UI |
| Бэкенд | Rust (Axum) + PostgreSQL |

---

## Лицензия

MIT. Подробности — в файле [LICENSE](LICENSE).

Основан на [SoundCloud Desktop](https://github.com/zxcloli666/SoundCloud-Desktop) от [zxcloli666](https://github.com/zxcloli666).  
SoundCloud — торговая марка SoundCloud Ltd. Этот проект не аффилирован с SoundCloud.

---

<p align="center">
<code>soundcloud desktop</code> · <code>soundcloud без рекламы</code> · <code>soundcloud россия</code> · <code>soundcloud клиент</code> · <code>soundcloud windows</code> · <code>soundcloud linux</code> · <code>soundcloud macos</code> · <code>soundcloud мод</code> · <code>soundcloud fork</code> · <code>soundcloud crossfade</code> · <code>soundcloud mini player</code>
</p>
