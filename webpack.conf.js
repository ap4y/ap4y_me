"use strict";
const path = require("path");

const CleanWebpackPlugin = require("clean-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const ManifestPlugin = require("webpack-manifest-plugin");

const paths = {
  DIST: path.resolve(__dirname, "static/bundle"),
  SRC: path.resolve(__dirname, "src"),
  JS: path.resolve(__dirname, "src/js"),
  DATA: path.resolve(__dirname, "data")
};

const devMode = process.env.NODE_ENV !== "production";

let plugins = [
  new CleanWebpackPlugin([paths.DIST]),
  new ManifestPlugin({
    fileName: path.join(paths.DATA, "manifest.json")
  }),
  new MiniCssExtractPlugin({
    filename: "bundle.[hash].css"
  })
];

// Webpack configuration
module.exports = {
  mode: process.env.NODE_ENV,
  entry: path.join(paths.JS, "main.js"),
  output: {
    path: paths.DIST,
    filename: "[name].[hash].js"
  },
  performance: { maxAssetSize: 310000 },
  devServer: {
    contentBase: paths.SRC,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers":
        "X-Requested-With, content-type, Authorization"
    }
  },
  plugins: plugins,
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /turbolinks/,
        use: {
          loader: "babel-loader",
          options: { presets: ["env"] }
        }
      },
      {
        test: /(\.css|\.scss)$/,
        use: [
          MiniCssExtractPlugin.loader,
          { loader: "css-loader" },
          "postcss-loader",
          "sass-loader"
        ]
      },
      {
        test: /\.(png|svg|jpg|gif)$/,
        use: ["file-loader"]
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/,
        use: ["file-loader"]
      }
    ]
  }
};
