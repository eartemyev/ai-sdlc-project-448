import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import type { Config } from "../app";
import { exportConfig } from "../app/config-file";
import { STORAGE_KEY } from "../app/storage";

const teamConfig: Config = {
  users: [
    { id: "outsider", name: "Вне команды", groupIds: [] },
    { id: "one", name: "Участник 1", groupIds: ["north", "other", "north"] },
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `member-${index + 2}`,
      name: `Участник ${index + 2}`,
      groupIds: ["north"],
    })),
    { id: "namesake", name: "Из одноимённой группы", groupIds: ["namesake"] },
  ],
  groups: [
    { id: "north", name: "Северная" },
    { id: "other", name: "Другая" },
    { id: "namesake", name: "Северная" },
    { id: "empty", name: "Пустая" },
  ],
  services: [{ id: "repository", name: "Репозиторий" }],
  permissions: [
    { id: "direct", subject: { type: "user", id: "one" }, serviceId: "repository" },
    { id: "group", subject: { type: "group", id: "other" }, serviceId: "repository" },
  ],
};

const loadTeam = (config = teamConfig) => {
  localStorage.setItem(STORAGE_KEY, exportConfig(config));
  return renderApp();
};

const options = (label: string) =>
  within(screen.getByRole("combobox", { name: label }))
    .getAllByRole("option")
    .map((option) => option.textContent);

const uploadConfig = async (config: Config) => {
  await userEvent
    .setup()
    .upload(
      screen.getByLabelText("Импортировать конфигурацию"),
      new File([exportConfig(config)], "config.json", { type: "application/json" }),
    );
  await screen.findByText("Конфигурация заменена");
  await waitFor(() =>
    expect(screen.getByTestId("export-link")).toHaveAttribute(
      "href",
      `data:application/json;charset=utf-8,${encodeURIComponent(exportConfig(config))}`,
    ),
  );
};

const renderApp = () =>
  render(
    <MantineProvider>
      <App />
    </MantineProvider>,
  );

const pick = async (user: string, service: string) => {
  const events = userEvent.setup();
  await events.selectOptions(screen.getByTestId("user-select"), user);
  await events.selectOptions(screen.getByTestId("service-select"), service);
};

describe("экран расчёта доступа", () => {
  it("сохраняет фильтр и выбранного сотрудника при выдаче и отзыве разрешений", async () => {
    loadTeam();
    const events = userEvent.setup();
    await events.selectOptions(screen.getByLabelText("Группа"), "north");
    await pick("one", "repository");
    await events.click(screen.getByTestId("permission-remove-direct"));
    expect(screen.getByLabelText("Группа")).toHaveValue("north");
    expect(screen.getByLabelText("Сотрудник")).toHaveValue("one");
    expect(screen.getByLabelText("Сервис")).toHaveValue("repository");
    expect(screen.getByTestId("access-sources")).toHaveTextContent("Группа «Другая»");
    expect(screen.getByTestId("access-sources")).not.toHaveTextContent("Прямое разрешение");
    await events.selectOptions(screen.getByLabelText("Кому выдать"), "user:one");
    await events.selectOptions(screen.getByLabelText("К какому сервису"), "repository");
    await events.click(screen.getByTestId("permission-add"));
    expect(screen.getByLabelText("Группа")).toHaveValue("north");
    expect(screen.getByLabelText("Сотрудник")).toHaveValue("one");
    expect(screen.getByLabelText("Сервис")).toHaveValue("repository");
    expect(screen.getByTestId("access-sources")).toHaveTextContent("Прямое разрешение");
    expect(screen.getByTestId("access-sources")).toHaveTextContent("Группа «Другая»");
  });

  it("не сохраняет фильтр в конфигурации и начинает со всех групп после перезагрузки", async () => {
    const view = loadTeam();
    const beforeExport = screen.getByTestId("export-link").getAttribute("href");
    const beforeStorage = localStorage.getItem(STORAGE_KEY);
    await userEvent.setup().selectOptions(screen.getByLabelText("Группа"), "north");
    await pick("one", "repository");
    expect(screen.getByTestId("export-link")).toHaveAttribute("href", beforeExport);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(beforeStorage);
    view.unmount();
    renderApp();
    expect(screen.getByLabelText("Группа")).toHaveValue("");
    expect(screen.getByLabelText("Сотрудник")).toHaveValue("");
    expect(options("Сотрудник")).toHaveLength(11);
    expect(screen.getByTestId("export-link")).toHaveAttribute("href", beforeExport);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(beforeStorage);
  });

  it("сохраняет фильтр, выбор и данные после отклонённого импорта", async () => {
    loadTeam();
    const events = userEvent.setup();
    await events.selectOptions(screen.getByLabelText("Группа"), "north");
    await pick("one", "repository");
    const beforeOptions = options("Сотрудник");
    const beforeExport = screen.getByTestId("export-link").getAttribute("href");
    const beforeStorage = localStorage.getItem(STORAGE_KEY);
    await events.upload(
      screen.getByLabelText("Импортировать конфигурацию"),
      new File(
        [
          exportConfig({
            ...teamConfig,
            permissions: [
              { id: "bad", subject: { type: "user", id: "missing" }, serviceId: "repository" },
            ],
          }),
        ],
        "invalid.json",
        { type: "application/json" },
      ),
    );
    await screen.findByTestId("import-error");
    expect(screen.getByLabelText("Группа")).toHaveValue("north");
    expect(screen.getByLabelText("Сотрудник")).toHaveValue("one");
    expect(screen.getByLabelText("Сервис")).toHaveValue("repository");
    expect(options("Сотрудник")).toEqual(beforeOptions);
    expect(screen.getByTestId("access-sources")).toHaveTextContent("Группа «Другая»");
    expect(screen.getByTestId("access-result")).toHaveTextContent("Доступ есть");
    expect(screen.getByTestId("export-link")).toHaveAttribute("href", beforeExport);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(beforeStorage);
  });

  it("сохраняет допустимые идентификаторы и пересчитывает доступ после импорта", async () => {
    loadTeam();
    await userEvent.setup().selectOptions(screen.getByLabelText("Группа"), "north");
    await pick("one", "repository");
    await uploadConfig({
      ...teamConfig,
      groups: teamConfig.groups.map((group) =>
        group.id === "north" ? { ...group, name: "Новое имя" } : group,
      ),
      permissions: [],
    });
    expect(screen.getByLabelText("Группа")).toHaveValue("north");
    expect(options("Группа")).toContain("Новое имя");
    expect(screen.getByLabelText("Сотрудник")).toHaveValue("one");
    expect(screen.getByLabelText("Сервис")).toHaveValue("repository");
    expect(screen.getByTestId("access-result")).toHaveTextContent("Доступа нет");
    expect(screen.queryByTestId("access-sources")).not.toBeInTheDocument();
  });

  it("сбрасывает сотрудника при изменении членства импортом и сохраняет группу и сервис", async () => {
    loadTeam();
    const events = userEvent.setup();
    await events.selectOptions(screen.getByLabelText("Группа"), "north");
    await pick("one", "repository");
    await uploadConfig({
      ...teamConfig,
      users: teamConfig.users.map((user) =>
        user.id === "one" ? { ...user, groupIds: ["other"] } : user,
      ),
    });
    expect(screen.getByLabelText("Группа")).toHaveValue("north");
    expect(screen.getByLabelText("Сервис")).toHaveValue("repository");
    expect(screen.getByLabelText("Сотрудник")).toHaveValue("");
    expect(options("Сотрудник")).not.toContain("Участник 1");
    expect(screen.getByTestId("access-result")).toHaveTextContent("Выберите сотрудника и сервис");
    expect(screen.queryByTestId("access-sources")).not.toBeInTheDocument();
    await events.selectOptions(screen.getByLabelText("Группа"), "");
    expect(screen.getByLabelText("Сотрудник")).toHaveValue("");
  });

  it("сбрасывает удалённые импортом группу, сотрудника и сервис без восстановления старого выбора", async () => {
    loadTeam();
    const events = userEvent.setup();
    await events.selectOptions(screen.getByLabelText("Группа"), "north");
    await pick("one", "repository");
    await uploadConfig({ users: [], groups: [], services: [], permissions: [] });
    expect(screen.getByLabelText("Группа")).toHaveValue("");
    expect(screen.getByLabelText("Сотрудник")).toHaveValue("");
    expect(screen.getByLabelText("Сервис")).toHaveValue("");
    expect(screen.getByTestId("access-result")).toHaveTextContent("Выберите сотрудника и сервис");
    expect(screen.queryByTestId("access-sources")).not.toBeInTheDocument();
    await uploadConfig(teamConfig);
    expect(screen.getByLabelText("Группа")).toHaveValue("");
    expect(screen.getByLabelText("Сотрудник")).toHaveValue("");
    expect(screen.getByLabelText("Сервис")).toHaveValue("");
  });

  it("учитывает прямой доступ и другую группу, сохраняя полный редактор разрешений", async () => {
    loadTeam();
    await userEvent.setup().selectOptions(screen.getByLabelText("Группа"), "north");
    await pick("one", "repository");
    expect(screen.getByTestId("access-sources")).toHaveTextContent("Прямое разрешение");
    expect(screen.getByTestId("access-sources")).toHaveTextContent("Группа «Другая»");
    expect(options("Кому выдать")).toContain("Вне команды");
    expect(options("Кому выдать")).toContain("Группа «Другая»");
    expect(screen.getAllByTestId(/^permission-item-/)).toHaveLength(2);
  });

  it("сохраняет допустимый выбор и сбрасывает исключённого фильтром сотрудника", async () => {
    loadTeam();
    const events = userEvent.setup();
    await pick("one", "repository");
    for (const group of ["north", "other", ""]) {
      await events.selectOptions(screen.getByLabelText("Группа"), group);
      expect(screen.getByLabelText("Сотрудник")).toHaveValue("one");
      expect(screen.getByTestId("access-result")).toHaveTextContent("Доступ есть");
    }
    for (const excludedGroup of ["namesake", "empty"]) {
      await events.selectOptions(screen.getByLabelText("Группа"), excludedGroup);
      expect(screen.getByLabelText("Сотрудник")).toHaveValue("");
      expect(screen.getByLabelText("Сервис")).toHaveValue("repository");
      expect(screen.getByTestId("access-result")).toHaveTextContent("Выберите сотрудника и сервис");
      expect(screen.queryByTestId("access-sources")).not.toBeInTheDocument();
      await events.selectOptions(screen.getByLabelText("Группа"), "");
      expect(screen.getByLabelText("Сотрудник")).toHaveValue("");
      await events.selectOptions(screen.getByLabelText("Сотрудник"), "one");
    }
  });

  it("позволяет выбрать сотрудника, когда групп нет", () => {
    loadTeam({ ...teamConfig, groups: [], permissions: [], users: [teamConfig.users[0]!] });
    expect(options("Группа")).toEqual(["Все группы"]);
    expect(options("Сотрудник")).toEqual(["Не выбран", "Вне команды"]);
  });

  it("объясняет пустую группу и возвращает полный список после очистки фильтра", async () => {
    loadTeam();
    const events = userEvent.setup();
    await events.selectOptions(screen.getByLabelText("Группа"), "empty");
    expect(options("Сотрудник")).toEqual(["Не выбран"]);
    expect(screen.getByText("В группе нет сотрудников")).toBeInTheDocument();
    await events.selectOptions(screen.getByLabelText("Группа"), "");
    expect(options("Сотрудник")).toHaveLength(11);
    expect(options("Сотрудник")).toContain("Вне команды");
    expect(screen.queryByText("В группе нет сотрудников")).not.toBeInTheDocument();
  });

  it("показывает только восемь участников выбранной группы и позволяет проверить каждого", async () => {
    loadTeam();
    const events = userEvent.setup();
    await events.selectOptions(screen.getByLabelText("Группа"), "north");

    expect(options("Сотрудник")).toEqual([
      "Не выбран",
      "Участник 1",
      "Участник 2",
      "Участник 3",
      "Участник 4",
      "Участник 5",
      "Участник 6",
      "Участник 7",
      "Участник 8",
    ]);
    expect(screen.getByLabelText("Сотрудник")).toHaveValue("");
    await events.selectOptions(screen.getByLabelText("Сервис"), "repository");
    for (const id of [
      "one",
      "member-2",
      "member-3",
      "member-4",
      "member-5",
      "member-6",
      "member-7",
      "member-8",
    ]) {
      await events.selectOptions(screen.getByLabelText("Сотрудник"), id);
      expect(screen.getByLabelText("Сотрудник")).toHaveValue(id);
      expect(screen.getByTestId("access-result")).toHaveTextContent(
        id === "one" ? "Доступ есть" : "Доступа нет",
      );
    }
    await events.selectOptions(screen.getByLabelText("Группа"), "other");
    expect(options("Сотрудник")).toEqual(["Не выбран", "Участник 1"]);
    await events.selectOptions(screen.getByLabelText("Группа"), "namesake");
    expect(options("Сотрудник")).toEqual(["Не выбран", "Из одноимённой группы"]);
  });

  it("начинает со всех групп и показывает сотрудников в порядке конфигурации", () => {
    loadTeam();

    expect(screen.getByRole("combobox", { name: "Группа" })).toHaveValue("");
    expect(options("Группа")).toEqual(["Все группы", "Северная", "Другая", "Северная", "Пустая"]);
    expect(options("Сотрудник")).toEqual([
      "Не выбран",
      "Вне команды",
      "Участник 1",
      "Участник 2",
      "Участник 3",
      "Участник 4",
      "Участник 5",
      "Участник 6",
      "Участник 7",
      "Участник 8",
      "Из одноимённой группы",
    ]);
    const fields = screen.getAllByRole("combobox");
    expect(fields.indexOf(screen.getByLabelText("Группа"))).toBeLessThan(
      fields.indexOf(screen.getByLabelText("Сотрудник")),
    );
  });

  it("предлагает выбрать сотрудника и сервис до расчёта", () => {
    renderApp();

    expect(screen.getByTestId("access-result")).toHaveTextContent("Выберите сотрудника и сервис");
  });

  it("показывает доступ по прямому разрешению", async () => {
    renderApp();
    await pick("Борис Каримов", "Репозиторий");

    expect(screen.getByTestId("access-result")).toHaveTextContent("Доступ есть");
    expect(screen.getByTestId("access-sources")).toHaveTextContent("Прямое разрешение");
  });

  it("показывает доступ по разрешению группы", async () => {
    renderApp();
    await pick("Вера Лисицына", "Репозиторий");

    expect(screen.getByTestId("access-result")).toHaveTextContent("Доступ есть");
    expect(screen.getByTestId("access-sources")).toHaveTextContent("Группа «Разработка»");
  });

  it("показывает прямой и групповой источники вместе", async () => {
    renderApp();
    await pick("Анна Белова", "Учёт");

    expect(screen.getByTestId("access-sources")).toHaveTextContent("Прямое разрешение");
    expect(screen.getByTestId("access-sources")).toHaveTextContent("Группа «Бухгалтерия»");
  });

  it("сообщает об отсутствии доступа", async () => {
    renderApp();
    await pick("Вера Лисицына", "Учёт");

    expect(screen.getByTestId("access-result")).toHaveTextContent("Доступа нет");
    expect(screen.queryByTestId("access-sources")).not.toBeInTheDocument();
  });
});
