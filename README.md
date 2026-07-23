This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 素材许可（Attribution）

- `public/textures/` 下的行星/月球/太阳表面纹理（2K 底图与 `4k_*` 近观细节层）与土星环纹理来自
  [Solar System Scope Textures](https://www.solarsystemscope.com/textures/)，
  许可协议 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（基于 NASA 观测数据制作）。
  4K 细节层由 SSS 8K 源图本地降采样至 4096×2048（P4）；官方对天王星、海王星、土星环仅提供 2K 源图，
  相应贴图维持 2K。纹理清单与代码内登记见 `src/data/textures.ts`；加载失败时自动降级为程序化纹理
  （`src/components/CelestialBody/proceduralTextures.ts`）。
- 法线贴图（P4 近观立体细节，本仓库由公开高程数据转换生成）：
  - `4k_earth_normal.jpg`：NASA Earth Observatory
    [GEBCO 全球地形图](https://visibleearth.nasa.gov/images/73934/topography)（公有领域）转换；
  - `4k_moon_normal.jpg`：NASA SVS [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720)
    LOLA LDEM 高程数据（公有领域）转换；
  - `4k_mars_normal.jpg`：降级路径——无可获取的轻量 MOLA DEM（USGS 全分辨率 11 GB），
    由火星 4K 色彩贴图亮度推导生成（登记于 REQUIREMENTS.md §4.7）。
- 彗核形状参数（哈雷 15×8 km 花生形）依据 ESA Giotto 任务观测数据（`src/utils/cometNucleus.ts` 登记）。
- 矮行星真实贴图（P5，公有领域，本地降采样至 2K 底图 2048×1024 + 4K 近观层 4096×2048）：
  - `2k_pluto.jpg` / `4k_pluto.jpg`：NASA New Horizons LORRI/MVIC
    [全球拼接彩色地图](https://www.nasa.gov/image-feature/pluto-global-color-map)
    （NASA / Johns Hopkins University APL / Southwest Research Institute，公有领域）；
    南纬约 30° 以南为黑色未测绘区（飞掠时处于极夜，科学事实）；
  - `2k_ceres.jpg` / `4k_ceres.jpg`：NASA Dawn FC 全球拼接图（USGS Astrogeology
    Ceres_Dawn_FC_DLR_global_20ppd_Oct2015，https://planetarymaps.usgs.gov/mosaic/ 托管，
    NASA / JPL-Caltech / UCLA / MPS / DLR / IDA，公有领域）；
  - `4k_pluto_normal.jpg`：USGS Astrogeology
    Pluto_NewHorizons_Global_DEM_300m_Jul2017（公有领域，620 MB 源数据本地转换）；
    未测绘半球置平（与彩色贴图黑色未测绘区一致），测绘区边缘噪声经模糊 +
    梯度钳制抑制（残余粗糙感属源 DEM 立体像对不确定度）；
  - `4k_ceres_normal.jpg`：USGS Astrogeology
    Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016（公有领域，467 MB 源数据本地转换）；
  - 阋神星/鸟神星/妊神星无探测器实拍表面图，使用基于观测特征（反照率/颜色/光谱）的
    程序化增强纹理，艺术化推测部分登记于 `proceduralTextures.ts` 文件头。

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
