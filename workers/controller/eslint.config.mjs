import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
	eslint.configs.recommended,
	tseslint.configs.eslintRecommended,
	...tseslint.configs.strictTypeChecked,
	...tseslint.configs.stylisticTypeChecked,
	prettierConfig,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		ignores: ["vitest.config.mts"],
	},
);
