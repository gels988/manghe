#!/bin/bash

# 设置项目路径和仓库名
PROJECT_DIR="/mnt/d/独数九宫格"
REPO_NAME="manghe-project"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "❌ 错误：找不到 $PROJECT_DIR 文件夹，请检查路径"
else
    cd "$PROJECT_DIR"
    
    # 初始化 Git 子模块并更新它们
    git submodule init
    git submodule update

    # 添加所有文件到 Git 仓库中，并完成第一次提交
    git add .
    git commit -m "Initial commit: 独数九宫格项目上传，包含子模块"

    # 使用 GitHub CLI (gh) 创建仓库并推送到 GitHub，如果失败则尝试通过 Git 命令推送
    gh repo create $REPO_NAME --public --source=. --push 2>/dev/null || {
        git remote add origin https://github.com/gels988/$REPO_NAME.git

        # 使用 OAuth 令牌进行推送到 GitHub
        if [ -n "$GITHUB_TOKEN" ]; then
            echo "Using GitHub token for authentication"
            GITHUB_TOKEN=$(cat .env | grep -oP '(?<=GITHUB_TOKEN=).*')
            git push --set-upstream -u origin main \
                --repo="https://x-token-auth:$GITHUB_TOKEN@github.com/gels988/$REPO_NAME.git"
        else
            echo "❌ 错误：缺少 GitHub 凭证，请确保已正确配置 OAuth 令牌"
            exit 1
        fi
    }
    
    # 输出仓库 URL
    if [ $? -eq 0 ]; then
        echo "✅ 代码已推送至 GitHub: https://github.com/gels988/$REPO_NAME"

        # 部署到 Vercel
        npm install -g vercel 2>/dev/null
        cd "$PROJECT_DIR"
        vercel --prod --yes --name manghe-gels988

        echo ""
        echo "🎉 部署完成！你的全球访问链接是："
        echo "   https://manghe-gels988.vercel.app"
    else
        echo "❌ 推送失败，请检查凭证和权限"
    fi
fi